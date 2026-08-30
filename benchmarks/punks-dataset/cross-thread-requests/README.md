# cross-thread-requests

The harness posts ALPHA and BETA as separate top-level human mentions in the
same channel before the queue flushes. Passing requires two different replies,
each anchored to its own triggering event with only its own answer. This is a
deliberately hard guard for the cross-thread contamination reported in
[punksbot/punksbot#5839](https://github.com/punksbot/punksbot/issues/5839) and the exact
reply-target contract in
[punksbot/punksbot#4072](https://github.com/punksbot/punksbot/issues/4072).
