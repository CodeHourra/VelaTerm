import { expect, it, vi, beforeEach, afterEach } from "vitest";

const { call, spawn }=vi.hoisted(()=>({call:vi.fn(),spawn:vi.fn()}));
vi.mock("./wsClient",()=>({wsClient:{invoke:call,spawnPty:spawn,isDiagnosticReady:()=>true},bytesToB64:vi.fn()}));
vi.mock("../i18n",()=>({t:(key:string)=>key}));
import { invoke, spawnPty } from "./transport";
import { beginDiagnosticOperation } from "./diagnosticSafety";

beforeEach(()=>{call.mockReset();spawn.mockReset();});
afterEach(()=>{vi.unstubAllGlobals();});

it("records safe completion metadata while leaving request and response values intact",async()=>{
  const privateValue="synthetic-private-document";
  call.mockImplementation((cmd:string)=>Promise.resolve(cmd==="diagnostic_event" ? true : privateValue));
  expect(await invoke("get_tree",{query:privateValue})).toBe(privateValue);
  const [command,args,trace]=call.mock.calls[0];
  expect(command).toBe("get_tree");
  expect(args.query).toBe(privateValue);
  expect(args).toEqual({query:privateValue});
  expect(trace.requestId).toMatch(/^[0-9a-f-]{36}$/);
  await vi.waitFor(()=>expect(call.mock.calls.length).toBe(2));
  const [event,metadata]=call.mock.calls[1];
  expect(event).toBe("diagnostic_event");
  expect(metadata.requestId).toBe(trace.requestId);
  expect(metadata.status).toBe("success");
  expect(JSON.stringify(metadata)).not.toContain(privateValue);
});

it("diagnostic delivery failure never recursively generates more diagnostic requests",async()=>{
  call.mockImplementation((cmd:string)=>cmd==="diagnostic_event" ? Promise.reject(new Error("synthetic-secret")) : Promise.resolve(7));
  expect(await invoke("get_tree")).toBe(7);
  await new Promise(resolve=>setTimeout(resolve,10));
  expect(call).toHaveBeenCalledTimes(2);
});

it("loads startup data and correlates requests when LAN HTTP has no randomUUID",async()=>{
  vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
  const operationId=beginDiagnosticOperation("http-startup");
  call.mockResolvedValue([]);
  expect(await invoke("list_shells",{sessionId:"http-startup"})).toEqual([]);
  const trace=call.mock.calls[0][2];
  expect(trace.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(trace.operationId).toBe(operationId);
  await vi.waitFor(()=>expect(call.mock.calls.length).toBe(2));
  expect(call.mock.calls[1][1].requestId).toBe(trace.requestId);
});

it("attaches a terminal and forwards output when LAN HTTP has no randomUUID",async()=>{
  vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
  const output=vi.fn();
  const bytes=new Uint8Array([79,75]);
  const result={pid:1,launch:null,attached:true,cols:80,rows:24,owner:"ws-1"};
  spawn.mockImplementation((_args,onBytes)=>{onBytes(bytes);return Promise.resolve(result);});
  call.mockResolvedValue(true);
  expect(await spawnPty({sessionId:"http-terminal",kind:"terminal",cols:80,rows:24},output)).toEqual(result);
  expect(output).toHaveBeenCalledWith(bytes);
  expect(spawn.mock.calls[0][0].diagnosticRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
