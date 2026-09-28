import Select from "../../components/Select";
import { useT } from "../../i18n";

/** Backend-owned distribution catalog and successful/default selection. */
export type WslOptions = { supported: boolean; distributions: string[]; selected: string | null; error: string | null };

export function WslConnectForm({ options, loading, error, distribution, busy, onChange, onRefresh }: {
  options: WslOptions | null;
  loading: boolean;
  error: string;
  distribution: string;
  busy: boolean;
  onChange: (distribution: string) => void;
  onRefresh: () => void;
}) {
  const t = useT();
  return <div className="wsl-connect-form">
    <p className="wsl-connect-hint">{t("connect.wslHint")}</p>
    {loading ? <p role="status">{t("common.loading")}</p> : error ? <p role="alert" className="wsl-connect-error">{error}</p>
      : !options?.supported ? <p role="status">{t("connect.wslUnsupported")}</p>
      : options.distributions.length === 0 ? <p role="status">{t("connect.wslEmpty")}</p>
      : <div className="wsl-connect-field">
        <span>{t("connect.wslDistribution")}</span>
        <Select value={distribution} ariaLabel={t("connect.wslDistribution")} width="100%" menuPortal
          placeholder={t("connect.wslSelect")} disabled={busy}
          options={options.distributions.map(name => ({ value: name, label: name }))} onChange={onChange} />
        {!!distribution && !options.distributions.includes(distribution) && <p role="alert" className="wsl-connect-error">{t("connect.wslMissing")}</p>}
      </div>}
    <button type="button" className="vlx-btn" onClick={onRefresh} disabled={busy || loading}>{t("common.refresh")}</button>
    <p className="wsl-connect-hint">{t("connect.wslSetup")}</p>
  </div>;
}
