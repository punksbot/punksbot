# ambiguous-user-mention

The channel contains two real identities with the exact same three-word display
name. Their profile `about` fields carry different routing codes. The agent must
discover the intended pubkey, notify it exactly once, never notify the twin,
and separately callback the requester. This guards the silent ambiguity family
reported in [punksbot/punksbot#4303](https://github.com/punksbot/punksbot/issues/4303) and
[punksbot/punksbot#6257](https://github.com/punksbot/punksbot/issues/6257).
