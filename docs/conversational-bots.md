# Creating bots conversationally

Ask in chat or voice: “Create a bot called Gameye Sales to help review sales
opportunities.” Downy uses `create_bot`, stores the supplied name and purpose,
and posts a persistent link to the new bot's chat. No automatic per-task bot offers
are made. A purpose is optional; Downy should not invent one on your behalf.

Names map to stable slugs. Repeating the same name resumes the same bot, and
initialization does not overwrite an existing identity. A colliding or archived
name requires a different name. Failed initialization is retryable and is not
reported as success.

The bot gets an isolated workspace and the normal Downy built-in tools. Existing
MCP connections, account credentials, schedules and tasks are not copied. Connect
accounts separately when needed. Creation does not authorize sending, publishing,
paid enrichment or starting scheduled work.
