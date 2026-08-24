import '../generated/dart/punks_contracts.dart';

void expectFormat(void Function() action, String label) {
  try {
    action();
  } on FormatException {
    return;
  }
  throw StateError('$label should throw FormatException');
}
void main() {
  const uuid = '00000000-0000-8000-8000-000000000001';

  final history = MessageHistoryQuery.fromJson(<String, Object?>{
    'contract': 'message.history@1',
    'workspaceId': uuid,
    'conversationId': uuid,
    'cursor': null,
    'limit': 50,
    'direction': 'older',
  });
  if (history.contract != 'message.history@1' || history.limit != 50) {
    throw StateError('MessageHistoryQuery did not preserve its shape');
  }

  final frame = ConversationFollowServerFrame.fromJson(<String, Object?>{
    'schemaVersion': 1,
    'type': 'accepted',
    'resumeAfterCursor': 4,
    'targetHighWaterCursor': 6,
  });
  if (frame is! ConversationFollowServerFrameAccepted ||
      frame.toJson()['type'] != 'accepted') {
    throw StateError('FOLLOW union did not dispatch its accepted variant');
  }

  final problem = PunksProblem.fromJson(<String, Object?>{
    'type': 'https://punks.bot/problems/forbidden',
    'title': 'Forbidden',
    'status': 403,
    'code': 'forbidden',
    'correlationId': uuid,
    'retry': 'never',
  });
  if (problem.detail != null || problem.toJson().containsKey('detail')) {
    throw StateError('optional fields must remain optional');
  }

  final session = AuthSession.fromJson(<String, Object?>{
    'sessionId': uuid,
    'punkId': uuid,
    'authenticatedAt': '2026-08-22T12:00:00.000Z',
    'expiresAt': '2026-08-22T13:00:00.000Z',
    'recentReauthUntil': null,
    'punk': <String, Object?>{
      'id': uuid,
      'displayName': 'Punk',
      'avatarUrl': null,
    },
  });
  if (session.punk.displayName != 'Punk') {
    throw StateError('nested object was not decoded');
  }

  expectFormat(
    () => MessageHistoryQuery.fromJson(<String, Object?>{
      ...history.toJson(),
      'secret': 'must-be-rejected',
    }),
    'unknown field',
  );
  expectFormat(
    () => MessageHistoryQuery.fromJson(<String, Object?>{
      ...history.toJson(),
      'contract': 'message.history@2',
    }),
    'constant mismatch',
  );
  expectFormat(
    () => ConversationFollowServerFrame.fromJson(<String, Object?>{
      'schemaVersion': 1,
      'type': 'unknown-frame',
    }),
    'closed FOLLOW union',
  );
  expectFormat(
    () => MessageHistoryQuery.fromJson(<String, Object?>{
      'contract': 'message.history@1',
      'workspaceId': uuid,
      'conversationId': uuid,
      'cursor': null,
      'limit': 50,
    }),
    'null history cursor without direction',
  );
  expectFormat(
    () => MessageHistoryQuery.fromJson(<String, Object?>{
      'contract': 'message.history@1',
      'workspaceId': uuid,
      'conversationId': uuid,
      'cursor': null,
      'limit': 50,
      'direction': null,
    }),
    'null history direction',
  );
  expectFormat(
    () => MessageHistoryQuery.fromJson(<String, Object?>{
      ...history.toJson(),
      'threadRootMessageId': null,
    }),
    'present optional non-null field',
  );
}
