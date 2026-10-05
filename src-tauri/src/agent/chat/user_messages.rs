//! Compact navigation for the entire active timeline, without tool details or image bytes.

use super::engine::ChatRow;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMessage {
    pub id: String,
    pub text: String,
    pub has_images: bool,
}

pub fn outline(rows: &[ChatRow]) -> Vec<UserMessage> {
    rows.iter().filter_map(|row| match row {
        ChatRow::User { id, text, images, .. } => Some(UserMessage {
            id: id.clone(),
            text: text.split_whitespace().flat_map(|part| std::iter::once(' ').chain(part.chars())).skip(1).take(240).collect(),
            has_images: !images.is_empty(),
        }),
        _ => None,
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outline_keeps_user_order_without_replies_or_large_payloads() {
        let rows = vec![
            ChatRow::User { id: "first".into(), text: "  First\n question  ".into(), images: Vec::new(), at: None },
            ChatRow::Reasoning { id: "work".into(), text: "secret tool detail".repeat(100_000), streaming: false },
            ChatRow::User { id: "second".into(), text: "🧭".repeat(300), images: Vec::new(), at: None },
            ChatRow::User { id: "image".into(), text: String::new(), images: vec![super::super::protocol::ChatImage {
                mime_type: "image/png".into(), data: "private-image-bytes".into(),
            }], at: None },
        ];
        let messages = outline(&rows);
        assert_eq!(messages.iter().map(|item| item.id.as_str()).collect::<Vec<_>>(), vec!["first", "second", "image"]);
        assert_eq!(messages[0].text, "First question");
        assert_eq!(messages[1].text.chars().count(), 240);
        assert!(!messages[0].has_images);
        assert!(messages[2].has_images);
        assert!(messages[2].text.is_empty());
        let payload = serde_json::to_string(&messages).unwrap();
        assert!(!payload.contains("secret tool detail"));
        assert!(!payload.contains("private-image-bytes"));
        assert!(payload.len() < 1200);
    }
}
