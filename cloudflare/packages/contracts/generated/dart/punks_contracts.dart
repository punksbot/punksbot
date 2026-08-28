// Profil `desktop-social-loop@1` — projection Dart des contrats Punks.
// Généré par `cloudflare/packages/contracts/scripts/generate-artifacts.mjs`.
// NE PAS ÉDITER : toute modification passe par les schémas canoniques.
//
// Les objets, champs optionnels, constantes, enums et unions fermées
// projettent fidèlement la forme JSON Schema. Les contraintes de valeur
// restent vérifiées par le registre et le corpus commun de conformité.

Never _invalid(String path, String expected) =>
    throw FormatException('$path must be $expected');

Object? _requiredKey(Map<String, Object?> json, String key, String typeName) {
  if (!json.containsKey(key)) {
    throw FormatException('$typeName.$key is required');
  }
  return json[key];
}

bool _hasKey(Object? value, String key) =>
    value is Map<String, Object?> && value.containsKey(key);

Object? _valueAt(Object? value, String key) =>
    value is Map<String, Object?> ? value[key] : null;

void _rejectUnknownKeys(Map<String, Object?> json, Set<String> allowed, String typeName) {
  final unknown = json.keys.where((key) => !allowed.contains(key)).toList();
  if (unknown.isNotEmpty) {
    throw FormatException('$typeName contains unknown field ${unknown.first}');
  }
}

String _asString(Object? value, String path) => value is String ? value : _invalid(path, 'a string');
int _asInt(Object? value, String path) => value is int ? value : _invalid(path, 'an integer');
num _asNum(Object? value, String path) => value is num ? value : _invalid(path, 'a number');
bool _asBool(Object? value, String path) => value is bool ? value : _invalid(path, 'a boolean');
List<Object?> _asList(Object? value, String path) => value is List<Object?> ? value : _invalid(path, 'a JSON array');
Map<String, Object?> _asMap(Object? value, String path) => value is Map<String, Object?> ? value : _invalid(path, 'a JSON object');
Null _expectNull(Object? value, String path) => value == null ? null : _invalid(path, 'null');

String _expectStringConst(Object? value, String expected, String path) {
  final actual = _asString(value, path);
  if (actual != expected) _invalid(path, expected);
  return actual;
}

int _expectIntConst(Object? value, int expected, String path) {
  final actual = _asInt(value, path);
  if (actual != expected) _invalid(path, expected.toString());
  return actual;
}

// ignore: unused_element
num _expectNumConst(Object? value, num expected, String path) {
  final actual = _asNum(value, path);
  if (actual != expected) _invalid(path, expected.toString());
  return actual;
}

// ignore: unused_element
bool _expectBoolConst(Object? value, bool expected, String path) {
  final actual = _asBool(value, path);
  if (actual != expected) _invalid(path, expected.toString());
  return actual;
}

enum DesktopCompatibilityQueryDistribution {
  development("development"),
  staging("staging"),
  production("production"),
  ;

  const DesktopCompatibilityQueryDistribution(this.value);

  final String value;

  factory DesktopCompatibilityQueryDistribution.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a DesktopCompatibilityQueryDistribution value');
  }

  String toJson() => value;
}

enum DesktopCompatibilityQueryPlatform {
  macosArm64("macos-arm64"),
  macosX64("macos-x64"),
  linuxX64("linux-x64"),
  windowsX64("windows-x64"),
  ;

  const DesktopCompatibilityQueryPlatform(this.value);

  final String value;

  factory DesktopCompatibilityQueryPlatform.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a DesktopCompatibilityQueryPlatform value');
  }

  String toJson() => value;
}

class DesktopCompatibilityQuery {
  final String contract;
  final String profile;
  final String clientVersion;
  final DesktopCompatibilityQueryDistribution distribution;
  final DesktopCompatibilityQueryPlatform platform;

  const DesktopCompatibilityQuery({
    required this.contract,
    required this.profile,
    required this.clientVersion,
    required this.distribution,
    required this.platform,
  });

  factory DesktopCompatibilityQuery.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "profile", "clientVersion", "distribution", "platform"}, "DesktopCompatibilityQuery");
    return DesktopCompatibilityQuery(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopCompatibilityQuery"), "desktop.compatibility@1", "DesktopCompatibilityQuery.contract"),
      profile: _expectStringConst(_requiredKey(json, "profile", "DesktopCompatibilityQuery"), "desktop-social-loop@1", "DesktopCompatibilityQuery.profile"),
      clientVersion: _asString(_requiredKey(json, "clientVersion", "DesktopCompatibilityQuery"), "DesktopCompatibilityQuery.clientVersion"),
      distribution: DesktopCompatibilityQueryDistribution.fromJson(_requiredKey(json, "distribution", "DesktopCompatibilityQuery"), "DesktopCompatibilityQuery.distribution"),
      platform: DesktopCompatibilityQueryPlatform.fromJson(_requiredKey(json, "platform", "DesktopCompatibilityQuery"), "DesktopCompatibilityQuery.platform"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "profile": profile,
      "clientVersion": clientVersion,
      "distribution": distribution.toJson(),
      "platform": platform.toJson(),
    };
    return json;
  }
}

enum DesktopCompatibilityResponseEnvironment {
  local("local"),
  staging("staging"),
  production("production"),
  ;

  const DesktopCompatibilityResponseEnvironment(this.value);

  final String value;

  factory DesktopCompatibilityResponseEnvironment.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a DesktopCompatibilityResponseEnvironment value');
  }

  String toJson() => value;
}

class DesktopCompatibilityResponse {
  final String contract;
  final bool compatible;
  final String profile;
  final int registryVersion;
  final String minimumClientVersion;
  final DesktopCompatibilityResponseEnvironment environment;
  final String origin;
  final List<String> capabilities;

  const DesktopCompatibilityResponse({
    required this.contract,
    required this.compatible,
    required this.profile,
    required this.registryVersion,
    required this.minimumClientVersion,
    required this.environment,
    required this.origin,
    required this.capabilities,
  });

  factory DesktopCompatibilityResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "compatible", "profile", "registryVersion", "minimumClientVersion", "environment", "origin", "capabilities"}, "DesktopCompatibilityResponse");
    return DesktopCompatibilityResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopCompatibilityResponse"), "desktop.compatibility-response@1", "DesktopCompatibilityResponse.contract"),
      compatible: _asBool(_requiredKey(json, "compatible", "DesktopCompatibilityResponse"), "DesktopCompatibilityResponse.compatible"),
      profile: _expectStringConst(_requiredKey(json, "profile", "DesktopCompatibilityResponse"), "desktop-social-loop@1", "DesktopCompatibilityResponse.profile"),
      registryVersion: _expectIntConst(_requiredKey(json, "registryVersion", "DesktopCompatibilityResponse"), 1, "DesktopCompatibilityResponse.registryVersion"),
      minimumClientVersion: _asString(_requiredKey(json, "minimumClientVersion", "DesktopCompatibilityResponse"), "DesktopCompatibilityResponse.minimumClientVersion"),
      environment: DesktopCompatibilityResponseEnvironment.fromJson(_requiredKey(json, "environment", "DesktopCompatibilityResponse"), "DesktopCompatibilityResponse.environment"),
      origin: _asString(_requiredKey(json, "origin", "DesktopCompatibilityResponse"), "DesktopCompatibilityResponse.origin"),
      capabilities: _asList(_requiredKey(json, "capabilities", "DesktopCompatibilityResponse"), "DesktopCompatibilityResponse.capabilities").map((item) => _asString(item, "DesktopCompatibilityResponse.capabilities[]")).toList(growable: false),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "compatible": compatible,
      "profile": profile,
      "registryVersion": registryVersion,
      "minimumClientVersion": minimumClientVersion,
      "environment": environment.toJson(),
      "origin": origin,
      "capabilities": capabilities.map((item) => item).toList(growable: false),
    };
    return json;
  }
}

class AuthSessionPunk {
  final String id;
  final String displayName;
  final String? avatarUrl;

  const AuthSessionPunk({
    required this.id,
    required this.displayName,
    required this.avatarUrl,
  });

  factory AuthSessionPunk.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"id", "displayName", "avatarUrl"}, "AuthSessionPunk");
    return AuthSessionPunk(
      id: _asString(_requiredKey(json, "id", "AuthSessionPunk"), "AuthSessionPunk.id"),
      displayName: _asString(_requiredKey(json, "displayName", "AuthSessionPunk"), "AuthSessionPunk.displayName"),
      avatarUrl: _requiredKey(json, "avatarUrl", "AuthSessionPunk") == null ? null : _asString(_requiredKey(json, "avatarUrl", "AuthSessionPunk"), "AuthSessionPunk.avatarUrl"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "id": id,
      "displayName": displayName,
      "avatarUrl": avatarUrl == null ? null : avatarUrl!,
    };
    return json;
  }
}

class AuthSession {
  final String sessionId;
  final String punkId;
  final String authenticatedAt;
  final String expiresAt;
  final String? recentReauthUntil;
  final AuthSessionPunk punk;

  const AuthSession({
    required this.sessionId,
    required this.punkId,
    required this.authenticatedAt,
    required this.expiresAt,
    required this.recentReauthUntil,
    required this.punk,
  });

  factory AuthSession.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"sessionId", "punkId", "authenticatedAt", "expiresAt", "recentReauthUntil", "punk"}, "AuthSession");
    return AuthSession(
      sessionId: _asString(_requiredKey(json, "sessionId", "AuthSession"), "AuthSession.sessionId"),
      punkId: _asString(_requiredKey(json, "punkId", "AuthSession"), "AuthSession.punkId"),
      authenticatedAt: _asString(_requiredKey(json, "authenticatedAt", "AuthSession"), "AuthSession.authenticatedAt"),
      expiresAt: _asString(_requiredKey(json, "expiresAt", "AuthSession"), "AuthSession.expiresAt"),
      recentReauthUntil: _requiredKey(json, "recentReauthUntil", "AuthSession") == null ? null : _asString(_requiredKey(json, "recentReauthUntil", "AuthSession"), "AuthSession.recentReauthUntil"),
      punk: AuthSessionPunk.fromJson(_asMap(_requiredKey(json, "punk", "AuthSession"), "AuthSession.punk")),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "sessionId": sessionId,
      "punkId": punkId,
      "authenticatedAt": authenticatedAt,
      "expiresAt": expiresAt,
      "recentReauthUntil": recentReauthUntil == null ? null : recentReauthUntil!,
      "punk": punk.toJson(),
    };
    return json;
  }
}

enum DesktopAuthStartExchangeRequestIntent {
  signIn("sign_in"),
  switchAccount("switch_account"),
  reauthenticate("reauthenticate"),
  linkGoogle("link_google"),
  linkGithub("link_github"),
  ;

  const DesktopAuthStartExchangeRequestIntent(this.value);

  final String value;

  factory DesktopAuthStartExchangeRequestIntent.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a DesktopAuthStartExchangeRequestIntent value');
  }

  String toJson() => value;
}

enum DesktopAuthStartExchangeRequestMethod {
  google("google"),
  github("github"),
  ;

  const DesktopAuthStartExchangeRequestMethod(this.value);

  final String value;

  factory DesktopAuthStartExchangeRequestMethod.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a DesktopAuthStartExchangeRequestMethod value');
  }

  String toJson() => value;
}

enum DesktopAuthStartExchangeRequestPurpose {
  linkGoogle("link_google"),
  linkGithub("link_github"),
  transferWorkspaceOwnership("transfer_workspace_ownership"),
  ;

  const DesktopAuthStartExchangeRequestPurpose(this.value);

  final String value;

  factory DesktopAuthStartExchangeRequestPurpose.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a DesktopAuthStartExchangeRequestPurpose value');
  }

  String toJson() => value;
}

class DesktopAuthStartExchangeWorkspaceOwnershipTransfer {
  final String workspaceId;
  final String targetPunkId;
  final int expectedRevision;

  const DesktopAuthStartExchangeWorkspaceOwnershipTransfer({
    required this.workspaceId,
    required this.targetPunkId,
    required this.expectedRevision,
  });

  factory DesktopAuthStartExchangeWorkspaceOwnershipTransfer.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"workspaceId", "targetPunkId", "expectedRevision"}, "DesktopAuthStartExchangeWorkspaceOwnershipTransfer");
    return DesktopAuthStartExchangeWorkspaceOwnershipTransfer(
      workspaceId: _asString(_requiredKey(json, "workspaceId", "DesktopAuthStartExchangeWorkspaceOwnershipTransfer"), "DesktopAuthStartExchangeWorkspaceOwnershipTransfer.workspaceId"),
      targetPunkId: _asString(_requiredKey(json, "targetPunkId", "DesktopAuthStartExchangeWorkspaceOwnershipTransfer"), "DesktopAuthStartExchangeWorkspaceOwnershipTransfer.targetPunkId"),
      expectedRevision: _asInt(_requiredKey(json, "expectedRevision", "DesktopAuthStartExchangeWorkspaceOwnershipTransfer"), "DesktopAuthStartExchangeWorkspaceOwnershipTransfer.expectedRevision"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "workspaceId": workspaceId,
      "targetPunkId": targetPunkId,
      "expectedRevision": expectedRevision,
    };
    return json;
  }
}

class DesktopAuthStartExchangeRequest extends DesktopAuthStartExchange {
  final String contract;
  final String message;
  final DesktopAuthStartExchangeRequestIntent intent;
  final DesktopAuthStartExchangeRequestMethod method;
  final String verifierCommitment;
  final DesktopAuthStartExchangeRequestPurpose? purpose;
  final String? authorizationId;
  final DesktopAuthStartExchangeWorkspaceOwnershipTransfer? workspaceOwnershipTransfer;

  const DesktopAuthStartExchangeRequest({
    required this.contract,
    required this.message,
    required this.intent,
    required this.method,
    required this.verifierCommitment,
    this.purpose,
    this.authorizationId,
    this.workspaceOwnershipTransfer,
  }) : super();

  factory DesktopAuthStartExchangeRequest.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "intent", "method", "verifierCommitment", "purpose", "authorizationId", "workspaceOwnershipTransfer"}, "DesktopAuthStartExchangeRequest");
    return DesktopAuthStartExchangeRequest(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopAuthStartExchangeRequest"), "desktop-auth.start@1", "DesktopAuthStartExchangeRequest.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopAuthStartExchangeRequest"), "request", "DesktopAuthStartExchangeRequest.message"),
      intent: DesktopAuthStartExchangeRequestIntent.fromJson(_requiredKey(json, "intent", "DesktopAuthStartExchangeRequest"), "DesktopAuthStartExchangeRequest.intent"),
      method: DesktopAuthStartExchangeRequestMethod.fromJson(_requiredKey(json, "method", "DesktopAuthStartExchangeRequest"), "DesktopAuthStartExchangeRequest.method"),
      verifierCommitment: _asString(_requiredKey(json, "verifierCommitment", "DesktopAuthStartExchangeRequest"), "DesktopAuthStartExchangeRequest.verifierCommitment"),
      purpose: json.containsKey("purpose") ? DesktopAuthStartExchangeRequestPurpose.fromJson(json["purpose"], "DesktopAuthStartExchangeRequest.purpose") : null,
      authorizationId: json.containsKey("authorizationId") ? _asString(json["authorizationId"], "DesktopAuthStartExchangeRequest.authorizationId") : null,
      workspaceOwnershipTransfer: json.containsKey("workspaceOwnershipTransfer") ? DesktopAuthStartExchangeWorkspaceOwnershipTransfer.fromJson(_asMap(json["workspaceOwnershipTransfer"], "DesktopAuthStartExchangeRequest.workspaceOwnershipTransfer")) : null,
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "intent": intent.toJson(),
      "method": method.toJson(),
      "verifierCommitment": verifierCommitment,
    };
    if (purpose != null) {
      json["purpose"] = purpose!.toJson();
    }
    if (authorizationId != null) {
      json["authorizationId"] = authorizationId!;
    }
    if (workspaceOwnershipTransfer != null) {
      json["workspaceOwnershipTransfer"] = workspaceOwnershipTransfer!.toJson();
    }
    return json;
  }
}

enum DesktopAuthStartExchangeResponseIntent {
  signIn("sign_in"),
  switchAccount("switch_account"),
  reauthenticate("reauthenticate"),
  linkGoogle("link_google"),
  linkGithub("link_github"),
  ;

  const DesktopAuthStartExchangeResponseIntent(this.value);

  final String value;

  factory DesktopAuthStartExchangeResponseIntent.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a DesktopAuthStartExchangeResponseIntent value');
  }

  String toJson() => value;
}

enum DesktopAuthStartExchangeResponseMethod {
  google("google"),
  github("github"),
  ;

  const DesktopAuthStartExchangeResponseMethod(this.value);

  final String value;

  factory DesktopAuthStartExchangeResponseMethod.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a DesktopAuthStartExchangeResponseMethod value');
  }

  String toJson() => value;
}

class DesktopAuthStartExchangeResponse extends DesktopAuthStartExchange {
  final String contract;
  final String message;
  final String flowId;
  final String phase;
  final DesktopAuthStartExchangeResponseIntent intent;
  final DesktopAuthStartExchangeResponseMethod method;
  final String browserUrl;
  final String createdAt;
  final String expiresAt;

  const DesktopAuthStartExchangeResponse({
    required this.contract,
    required this.message,
    required this.flowId,
    required this.phase,
    required this.intent,
    required this.method,
    required this.browserUrl,
    required this.createdAt,
    required this.expiresAt,
  }) : super();

  factory DesktopAuthStartExchangeResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "flowId", "phase", "intent", "method", "browserUrl", "createdAt", "expiresAt"}, "DesktopAuthStartExchangeResponse");
    return DesktopAuthStartExchangeResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopAuthStartExchangeResponse"), "desktop-auth.start@1", "DesktopAuthStartExchangeResponse.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopAuthStartExchangeResponse"), "response", "DesktopAuthStartExchangeResponse.message"),
      flowId: _asString(_requiredKey(json, "flowId", "DesktopAuthStartExchangeResponse"), "DesktopAuthStartExchangeResponse.flowId"),
      phase: _expectStringConst(_requiredKey(json, "phase", "DesktopAuthStartExchangeResponse"), "started", "DesktopAuthStartExchangeResponse.phase"),
      intent: DesktopAuthStartExchangeResponseIntent.fromJson(_requiredKey(json, "intent", "DesktopAuthStartExchangeResponse"), "DesktopAuthStartExchangeResponse.intent"),
      method: DesktopAuthStartExchangeResponseMethod.fromJson(_requiredKey(json, "method", "DesktopAuthStartExchangeResponse"), "DesktopAuthStartExchangeResponse.method"),
      browserUrl: _asString(_requiredKey(json, "browserUrl", "DesktopAuthStartExchangeResponse"), "DesktopAuthStartExchangeResponse.browserUrl"),
      createdAt: _asString(_requiredKey(json, "createdAt", "DesktopAuthStartExchangeResponse"), "DesktopAuthStartExchangeResponse.createdAt"),
      expiresAt: _asString(_requiredKey(json, "expiresAt", "DesktopAuthStartExchangeResponse"), "DesktopAuthStartExchangeResponse.expiresAt"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "flowId": flowId,
      "phase": phase,
      "intent": intent.toJson(),
      "method": method.toJson(),
      "browserUrl": browserUrl,
      "createdAt": createdAt,
      "expiresAt": expiresAt,
    };
    return json;
  }
}

sealed class DesktopAuthStartExchange {
  const DesktopAuthStartExchange();

  factory DesktopAuthStartExchange.fromJson(Map<String, Object?> json) {
    switch (json["message"]) {
      case "request":
        return DesktopAuthStartExchangeRequest.fromJson(json);
      case "response":
        return DesktopAuthStartExchangeResponse.fromJson(json);
      default:
        throw FormatException('DesktopAuthStartExchange.message has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class DesktopAuthStatusExchangeRequest extends DesktopAuthStatusExchange {
  final String contract;
  final String message;
  final String flowId;
  final String verifierCommitment;

  const DesktopAuthStatusExchangeRequest({
    required this.contract,
    required this.message,
    required this.flowId,
    required this.verifierCommitment,
  }) : super();

  factory DesktopAuthStatusExchangeRequest.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "flowId", "verifierCommitment"}, "DesktopAuthStatusExchangeRequest");
    return DesktopAuthStatusExchangeRequest(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopAuthStatusExchangeRequest"), "desktop-auth.status@1", "DesktopAuthStatusExchangeRequest.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopAuthStatusExchangeRequest"), "request", "DesktopAuthStatusExchangeRequest.message"),
      flowId: _asString(_requiredKey(json, "flowId", "DesktopAuthStatusExchangeRequest"), "DesktopAuthStatusExchangeRequest.flowId"),
      verifierCommitment: _asString(_requiredKey(json, "verifierCommitment", "DesktopAuthStatusExchangeRequest"), "DesktopAuthStatusExchangeRequest.verifierCommitment"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "flowId": flowId,
      "verifierCommitment": verifierCommitment,
    };
    return json;
  }
}

enum DesktopAuthStatusExchangeResponsePhase {
  started("started"),
  browserComplete("browser_complete"),
  ready("ready"),
  delivering("delivering"),
  confirmed("confirmed"),
  cancelled("cancelled"),
  expired("expired"),
  ;

  const DesktopAuthStatusExchangeResponsePhase(this.value);

  final String value;

  factory DesktopAuthStatusExchangeResponsePhase.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a DesktopAuthStatusExchangeResponsePhase value');
  }

  String toJson() => value;
}

enum DesktopAuthStatusExchangeResponseResult {
  success("success"),
  humanActionRequired("human_action_required"),
  securityFailure("security_failure"),
  transientInterruption("transient_interruption"),
  ;

  const DesktopAuthStatusExchangeResponseResult(this.value);

  final String value;

  factory DesktopAuthStatusExchangeResponseResult.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a DesktopAuthStatusExchangeResponseResult value');
  }

  String toJson() => value;
}

enum DesktopAuthStatusExchangeResponseOutcomeCode {
  accountCreated("account_created"),
  accountCreationConfirmationRequired("account_creation_confirmation_required"),
  authenticated("authenticated"),
  cancelled("cancelled"),
  expired("expired"),
  linkRequired("link_required"),
  linkPending("link_pending"),
  linked("linked"),
  mergeRequired("merge_required"),
  providerError("provider_error"),
  reauthenticated("reauthenticated"),
  reauthenticationFailed("reauthentication_failed"),
  sessionExpired("session_expired"),
  temporarilyUnavailable("temporarily_unavailable"),
  ;

  const DesktopAuthStatusExchangeResponseOutcomeCode(this.value);

  final String value;

  factory DesktopAuthStatusExchangeResponseOutcomeCode.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a DesktopAuthStatusExchangeResponseOutcomeCode value');
  }

  String toJson() => value;
}

class DesktopAuthStatusExchangeDecision {
  final bool oldSessionUsable;
  final bool revokePreparedSession;
  final bool destroyWorkspaceContext;
  final bool retrySameRequest;
  final bool freshHumanActionRequired;

  const DesktopAuthStatusExchangeDecision({
    required this.oldSessionUsable,
    required this.revokePreparedSession,
    required this.destroyWorkspaceContext,
    required this.retrySameRequest,
    required this.freshHumanActionRequired,
  });

  factory DesktopAuthStatusExchangeDecision.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"oldSessionUsable", "revokePreparedSession", "destroyWorkspaceContext", "retrySameRequest", "freshHumanActionRequired"}, "DesktopAuthStatusExchangeDecision");
    return DesktopAuthStatusExchangeDecision(
      oldSessionUsable: _asBool(_requiredKey(json, "oldSessionUsable", "DesktopAuthStatusExchangeDecision"), "DesktopAuthStatusExchangeDecision.oldSessionUsable"),
      revokePreparedSession: _asBool(_requiredKey(json, "revokePreparedSession", "DesktopAuthStatusExchangeDecision"), "DesktopAuthStatusExchangeDecision.revokePreparedSession"),
      destroyWorkspaceContext: _asBool(_requiredKey(json, "destroyWorkspaceContext", "DesktopAuthStatusExchangeDecision"), "DesktopAuthStatusExchangeDecision.destroyWorkspaceContext"),
      retrySameRequest: _asBool(_requiredKey(json, "retrySameRequest", "DesktopAuthStatusExchangeDecision"), "DesktopAuthStatusExchangeDecision.retrySameRequest"),
      freshHumanActionRequired: _asBool(_requiredKey(json, "freshHumanActionRequired", "DesktopAuthStatusExchangeDecision"), "DesktopAuthStatusExchangeDecision.freshHumanActionRequired"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "oldSessionUsable": oldSessionUsable,
      "revokePreparedSession": revokePreparedSession,
      "destroyWorkspaceContext": destroyWorkspaceContext,
      "retrySameRequest": retrySameRequest,
      "freshHumanActionRequired": freshHumanActionRequired,
    };
    return json;
  }
}

class DesktopAuthStatusExchangeResponse extends DesktopAuthStatusExchange {
  final String contract;
  final String message;
  final String flowId;
  final DesktopAuthStatusExchangeResponsePhase phase;
  final bool terminal;
  final String expiresAt;
  final DesktopAuthStatusExchangeResponseResult result;
  final DesktopAuthStatusExchangeResponseOutcomeCode? outcomeCode;
  final DesktopAuthStatusExchangeDecision decision;

  const DesktopAuthStatusExchangeResponse({
    required this.contract,
    required this.message,
    required this.flowId,
    required this.phase,
    required this.terminal,
    required this.expiresAt,
    required this.result,
    required this.outcomeCode,
    required this.decision,
  }) : super();

  factory DesktopAuthStatusExchangeResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "flowId", "phase", "terminal", "expiresAt", "result", "outcomeCode", "decision"}, "DesktopAuthStatusExchangeResponse");
    return DesktopAuthStatusExchangeResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopAuthStatusExchangeResponse"), "desktop-auth.status@1", "DesktopAuthStatusExchangeResponse.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopAuthStatusExchangeResponse"), "response", "DesktopAuthStatusExchangeResponse.message"),
      flowId: _asString(_requiredKey(json, "flowId", "DesktopAuthStatusExchangeResponse"), "DesktopAuthStatusExchangeResponse.flowId"),
      phase: DesktopAuthStatusExchangeResponsePhase.fromJson(_requiredKey(json, "phase", "DesktopAuthStatusExchangeResponse"), "DesktopAuthStatusExchangeResponse.phase"),
      terminal: _asBool(_requiredKey(json, "terminal", "DesktopAuthStatusExchangeResponse"), "DesktopAuthStatusExchangeResponse.terminal"),
      expiresAt: _asString(_requiredKey(json, "expiresAt", "DesktopAuthStatusExchangeResponse"), "DesktopAuthStatusExchangeResponse.expiresAt"),
      result: DesktopAuthStatusExchangeResponseResult.fromJson(_requiredKey(json, "result", "DesktopAuthStatusExchangeResponse"), "DesktopAuthStatusExchangeResponse.result"),
      outcomeCode: _requiredKey(json, "outcomeCode", "DesktopAuthStatusExchangeResponse") == null ? null : DesktopAuthStatusExchangeResponseOutcomeCode.fromJson(_requiredKey(json, "outcomeCode", "DesktopAuthStatusExchangeResponse"), "DesktopAuthStatusExchangeResponse.outcomeCode"),
      decision: DesktopAuthStatusExchangeDecision.fromJson(_asMap(_requiredKey(json, "decision", "DesktopAuthStatusExchangeResponse"), "DesktopAuthStatusExchangeResponse.decision")),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "flowId": flowId,
      "phase": phase.toJson(),
      "terminal": terminal,
      "expiresAt": expiresAt,
      "result": result.toJson(),
      "outcomeCode": outcomeCode == null ? null : outcomeCode!.toJson(),
      "decision": decision.toJson(),
    };
    return json;
  }
}

sealed class DesktopAuthStatusExchange {
  const DesktopAuthStatusExchange();

  factory DesktopAuthStatusExchange.fromJson(Map<String, Object?> json) {
    switch (json["message"]) {
      case "request":
        return DesktopAuthStatusExchangeRequest.fromJson(json);
      case "response":
        return DesktopAuthStatusExchangeResponse.fromJson(json);
      default:
        throw FormatException('DesktopAuthStatusExchange.message has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class DesktopAuthClaimExchangeRequest extends DesktopAuthClaimExchange {
  final String contract;
  final String message;
  final String deliveryKind;
  final String flowId;
  final String verifier;

  const DesktopAuthClaimExchangeRequest({
    required this.contract,
    required this.message,
    required this.deliveryKind,
    required this.flowId,
    required this.verifier,
  }) : super();

  factory DesktopAuthClaimExchangeRequest.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "deliveryKind", "flowId", "verifier"}, "DesktopAuthClaimExchangeRequest");
    return DesktopAuthClaimExchangeRequest(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopAuthClaimExchangeRequest"), "desktop-auth.claim@1", "DesktopAuthClaimExchangeRequest.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopAuthClaimExchangeRequest"), "request", "DesktopAuthClaimExchangeRequest.message"),
      deliveryKind: _expectStringConst(_requiredKey(json, "deliveryKind", "DesktopAuthClaimExchangeRequest"), "request", "DesktopAuthClaimExchangeRequest.deliveryKind"),
      flowId: _asString(_requiredKey(json, "flowId", "DesktopAuthClaimExchangeRequest"), "DesktopAuthClaimExchangeRequest.flowId"),
      verifier: _asString(_requiredKey(json, "verifier", "DesktopAuthClaimExchangeRequest"), "DesktopAuthClaimExchangeRequest.verifier"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "deliveryKind": deliveryKind,
      "flowId": flowId,
      "verifier": verifier,
    };
    return json;
  }
}

class DesktopAuthClaimExchangeSessionPunk {
  final String id;
  final String displayName;
  final String? avatarUrl;

  const DesktopAuthClaimExchangeSessionPunk({
    required this.id,
    required this.displayName,
    required this.avatarUrl,
  });

  factory DesktopAuthClaimExchangeSessionPunk.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"id", "displayName", "avatarUrl"}, "DesktopAuthClaimExchangeSessionPunk");
    return DesktopAuthClaimExchangeSessionPunk(
      id: _asString(_requiredKey(json, "id", "DesktopAuthClaimExchangeSessionPunk"), "DesktopAuthClaimExchangeSessionPunk.id"),
      displayName: _asString(_requiredKey(json, "displayName", "DesktopAuthClaimExchangeSessionPunk"), "DesktopAuthClaimExchangeSessionPunk.displayName"),
      avatarUrl: _requiredKey(json, "avatarUrl", "DesktopAuthClaimExchangeSessionPunk") == null ? null : _asString(_requiredKey(json, "avatarUrl", "DesktopAuthClaimExchangeSessionPunk"), "DesktopAuthClaimExchangeSessionPunk.avatarUrl"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "id": id,
      "displayName": displayName,
      "avatarUrl": avatarUrl == null ? null : avatarUrl!,
    };
    return json;
  }
}

class DesktopAuthClaimExchangeSession {
  final String sessionId;
  final String punkId;
  final String authenticatedAt;
  final String expiresAt;
  final String? recentReauthUntil;
  final DesktopAuthClaimExchangeSessionPunk punk;

  const DesktopAuthClaimExchangeSession({
    required this.sessionId,
    required this.punkId,
    required this.authenticatedAt,
    required this.expiresAt,
    required this.recentReauthUntil,
    required this.punk,
  });

  factory DesktopAuthClaimExchangeSession.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"sessionId", "punkId", "authenticatedAt", "expiresAt", "recentReauthUntil", "punk"}, "DesktopAuthClaimExchangeSession");
    return DesktopAuthClaimExchangeSession(
      sessionId: _asString(_requiredKey(json, "sessionId", "DesktopAuthClaimExchangeSession"), "DesktopAuthClaimExchangeSession.sessionId"),
      punkId: _asString(_requiredKey(json, "punkId", "DesktopAuthClaimExchangeSession"), "DesktopAuthClaimExchangeSession.punkId"),
      authenticatedAt: _asString(_requiredKey(json, "authenticatedAt", "DesktopAuthClaimExchangeSession"), "DesktopAuthClaimExchangeSession.authenticatedAt"),
      expiresAt: _asString(_requiredKey(json, "expiresAt", "DesktopAuthClaimExchangeSession"), "DesktopAuthClaimExchangeSession.expiresAt"),
      recentReauthUntil: _requiredKey(json, "recentReauthUntil", "DesktopAuthClaimExchangeSession") == null ? null : _asString(_requiredKey(json, "recentReauthUntil", "DesktopAuthClaimExchangeSession"), "DesktopAuthClaimExchangeSession.recentReauthUntil"),
      punk: DesktopAuthClaimExchangeSessionPunk.fromJson(_asMap(_requiredKey(json, "punk", "DesktopAuthClaimExchangeSession"), "DesktopAuthClaimExchangeSession.punk")),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "sessionId": sessionId,
      "punkId": punkId,
      "authenticatedAt": authenticatedAt,
      "expiresAt": expiresAt,
      "recentReauthUntil": recentReauthUntil == null ? null : recentReauthUntil!,
      "punk": punk.toJson(),
    };
    return json;
  }
}

class DesktopAuthClaimExchangeCapability {
  final String token;
  final String expiresAt;

  const DesktopAuthClaimExchangeCapability({
    required this.token,
    required this.expiresAt,
  });

  factory DesktopAuthClaimExchangeCapability.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"token", "expiresAt"}, "DesktopAuthClaimExchangeCapability");
    return DesktopAuthClaimExchangeCapability(
      token: _asString(_requiredKey(json, "token", "DesktopAuthClaimExchangeCapability"), "DesktopAuthClaimExchangeCapability.token"),
      expiresAt: _asString(_requiredKey(json, "expiresAt", "DesktopAuthClaimExchangeCapability"), "DesktopAuthClaimExchangeCapability.expiresAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "token": token,
      "expiresAt": expiresAt,
    };
    return json;
  }
}

class DesktopAuthClaimExchangeSessionResponse extends DesktopAuthClaimExchange {
  final String contract;
  final String message;
  final String flowId;
  final String phase;
  final String deliveryKind;
  final String deliveryId;
  final DesktopAuthClaimExchangeSession session;
  final DesktopAuthClaimExchangeCapability revokeCapability;
  final String deliveryExpiresAt;

  const DesktopAuthClaimExchangeSessionResponse({
    required this.contract,
    required this.message,
    required this.flowId,
    required this.phase,
    required this.deliveryKind,
    required this.deliveryId,
    required this.session,
    required this.revokeCapability,
    required this.deliveryExpiresAt,
  }) : super();

  factory DesktopAuthClaimExchangeSessionResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "flowId", "phase", "deliveryKind", "deliveryId", "session", "revokeCapability", "deliveryExpiresAt"}, "DesktopAuthClaimExchangeSessionResponse");
    return DesktopAuthClaimExchangeSessionResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopAuthClaimExchangeSessionResponse"), "desktop-auth.claim@1", "DesktopAuthClaimExchangeSessionResponse.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopAuthClaimExchangeSessionResponse"), "response", "DesktopAuthClaimExchangeSessionResponse.message"),
      flowId: _asString(_requiredKey(json, "flowId", "DesktopAuthClaimExchangeSessionResponse"), "DesktopAuthClaimExchangeSessionResponse.flowId"),
      phase: _expectStringConst(_requiredKey(json, "phase", "DesktopAuthClaimExchangeSessionResponse"), "delivering", "DesktopAuthClaimExchangeSessionResponse.phase"),
      deliveryKind: _expectStringConst(_requiredKey(json, "deliveryKind", "DesktopAuthClaimExchangeSessionResponse"), "session", "DesktopAuthClaimExchangeSessionResponse.deliveryKind"),
      deliveryId: _asString(_requiredKey(json, "deliveryId", "DesktopAuthClaimExchangeSessionResponse"), "DesktopAuthClaimExchangeSessionResponse.deliveryId"),
      session: DesktopAuthClaimExchangeSession.fromJson(_asMap(_requiredKey(json, "session", "DesktopAuthClaimExchangeSessionResponse"), "DesktopAuthClaimExchangeSessionResponse.session")),
      revokeCapability: DesktopAuthClaimExchangeCapability.fromJson(_asMap(_requiredKey(json, "revokeCapability", "DesktopAuthClaimExchangeSessionResponse"), "DesktopAuthClaimExchangeSessionResponse.revokeCapability")),
      deliveryExpiresAt: _asString(_requiredKey(json, "deliveryExpiresAt", "DesktopAuthClaimExchangeSessionResponse"), "DesktopAuthClaimExchangeSessionResponse.deliveryExpiresAt"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "flowId": flowId,
      "phase": phase,
      "deliveryKind": deliveryKind,
      "deliveryId": deliveryId,
      "session": session.toJson(),
      "revokeCapability": revokeCapability.toJson(),
      "deliveryExpiresAt": deliveryExpiresAt,
    };
    return json;
  }
}

enum DesktopAuthClaimExchangeAuthorizationTargetMethod {
  linkGoogle("link_google"),
  linkGithub("link_github"),
  transferWorkspaceOwnership("transfer_workspace_ownership"),
  ;

  const DesktopAuthClaimExchangeAuthorizationTargetMethod(this.value);

  final String value;

  factory DesktopAuthClaimExchangeAuthorizationTargetMethod.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a DesktopAuthClaimExchangeAuthorizationTargetMethod value');
  }

  String toJson() => value;
}

class DesktopAuthClaimExchangeWorkspaceOwnershipTransfer {
  final String workspaceId;
  final String targetPunkId;
  final int expectedRevision;

  const DesktopAuthClaimExchangeWorkspaceOwnershipTransfer({
    required this.workspaceId,
    required this.targetPunkId,
    required this.expectedRevision,
  });

  factory DesktopAuthClaimExchangeWorkspaceOwnershipTransfer.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"workspaceId", "targetPunkId", "expectedRevision"}, "DesktopAuthClaimExchangeWorkspaceOwnershipTransfer");
    return DesktopAuthClaimExchangeWorkspaceOwnershipTransfer(
      workspaceId: _asString(_requiredKey(json, "workspaceId", "DesktopAuthClaimExchangeWorkspaceOwnershipTransfer"), "DesktopAuthClaimExchangeWorkspaceOwnershipTransfer.workspaceId"),
      targetPunkId: _asString(_requiredKey(json, "targetPunkId", "DesktopAuthClaimExchangeWorkspaceOwnershipTransfer"), "DesktopAuthClaimExchangeWorkspaceOwnershipTransfer.targetPunkId"),
      expectedRevision: _asInt(_requiredKey(json, "expectedRevision", "DesktopAuthClaimExchangeWorkspaceOwnershipTransfer"), "DesktopAuthClaimExchangeWorkspaceOwnershipTransfer.expectedRevision"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "workspaceId": workspaceId,
      "targetPunkId": targetPunkId,
      "expectedRevision": expectedRevision,
    };
    return json;
  }
}

class DesktopAuthClaimExchangeAuthorization {
  final String authorizationId;
  final String sessionId;
  final String punkId;
  final String intent;
  final DesktopAuthClaimExchangeAuthorizationTargetMethod targetMethod;
  final DesktopAuthClaimExchangeWorkspaceOwnershipTransfer? workspaceOwnershipTransfer;
  final String handoffId;
  final String expiresAt;

  const DesktopAuthClaimExchangeAuthorization({
    required this.authorizationId,
    required this.sessionId,
    required this.punkId,
    required this.intent,
    required this.targetMethod,
    this.workspaceOwnershipTransfer,
    required this.handoffId,
    required this.expiresAt,
  });

  factory DesktopAuthClaimExchangeAuthorization.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"authorizationId", "sessionId", "punkId", "intent", "targetMethod", "workspaceOwnershipTransfer", "handoffId", "expiresAt"}, "DesktopAuthClaimExchangeAuthorization");
    return DesktopAuthClaimExchangeAuthorization(
      authorizationId: _asString(_requiredKey(json, "authorizationId", "DesktopAuthClaimExchangeAuthorization"), "DesktopAuthClaimExchangeAuthorization.authorizationId"),
      sessionId: _asString(_requiredKey(json, "sessionId", "DesktopAuthClaimExchangeAuthorization"), "DesktopAuthClaimExchangeAuthorization.sessionId"),
      punkId: _asString(_requiredKey(json, "punkId", "DesktopAuthClaimExchangeAuthorization"), "DesktopAuthClaimExchangeAuthorization.punkId"),
      intent: _expectStringConst(_requiredKey(json, "intent", "DesktopAuthClaimExchangeAuthorization"), "reauthenticate", "DesktopAuthClaimExchangeAuthorization.intent"),
      targetMethod: DesktopAuthClaimExchangeAuthorizationTargetMethod.fromJson(_requiredKey(json, "targetMethod", "DesktopAuthClaimExchangeAuthorization"), "DesktopAuthClaimExchangeAuthorization.targetMethod"),
      workspaceOwnershipTransfer: json.containsKey("workspaceOwnershipTransfer") ? DesktopAuthClaimExchangeWorkspaceOwnershipTransfer.fromJson(_asMap(json["workspaceOwnershipTransfer"], "DesktopAuthClaimExchangeAuthorization.workspaceOwnershipTransfer")) : null,
      handoffId: _asString(_requiredKey(json, "handoffId", "DesktopAuthClaimExchangeAuthorization"), "DesktopAuthClaimExchangeAuthorization.handoffId"),
      expiresAt: _asString(_requiredKey(json, "expiresAt", "DesktopAuthClaimExchangeAuthorization"), "DesktopAuthClaimExchangeAuthorization.expiresAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "authorizationId": authorizationId,
      "sessionId": sessionId,
      "punkId": punkId,
      "intent": intent,
      "targetMethod": targetMethod.toJson(),
      "handoffId": handoffId,
      "expiresAt": expiresAt,
    };
    if (workspaceOwnershipTransfer != null) {
      json["workspaceOwnershipTransfer"] = workspaceOwnershipTransfer!.toJson();
    }
    return json;
  }
}

class DesktopAuthClaimExchangeReauthorizationResponse extends DesktopAuthClaimExchange {
  final String contract;
  final String message;
  final String flowId;
  final String phase;
  final String deliveryKind;
  final String deliveryId;
  final DesktopAuthClaimExchangeAuthorization authorization;
  final String deliveryExpiresAt;

  const DesktopAuthClaimExchangeReauthorizationResponse({
    required this.contract,
    required this.message,
    required this.flowId,
    required this.phase,
    required this.deliveryKind,
    required this.deliveryId,
    required this.authorization,
    required this.deliveryExpiresAt,
  }) : super();

  factory DesktopAuthClaimExchangeReauthorizationResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "flowId", "phase", "deliveryKind", "deliveryId", "authorization", "deliveryExpiresAt"}, "DesktopAuthClaimExchangeReauthorizationResponse");
    return DesktopAuthClaimExchangeReauthorizationResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopAuthClaimExchangeReauthorizationResponse"), "desktop-auth.claim@1", "DesktopAuthClaimExchangeReauthorizationResponse.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopAuthClaimExchangeReauthorizationResponse"), "response", "DesktopAuthClaimExchangeReauthorizationResponse.message"),
      flowId: _asString(_requiredKey(json, "flowId", "DesktopAuthClaimExchangeReauthorizationResponse"), "DesktopAuthClaimExchangeReauthorizationResponse.flowId"),
      phase: _expectStringConst(_requiredKey(json, "phase", "DesktopAuthClaimExchangeReauthorizationResponse"), "delivering", "DesktopAuthClaimExchangeReauthorizationResponse.phase"),
      deliveryKind: _expectStringConst(_requiredKey(json, "deliveryKind", "DesktopAuthClaimExchangeReauthorizationResponse"), "reauthorization", "DesktopAuthClaimExchangeReauthorizationResponse.deliveryKind"),
      deliveryId: _asString(_requiredKey(json, "deliveryId", "DesktopAuthClaimExchangeReauthorizationResponse"), "DesktopAuthClaimExchangeReauthorizationResponse.deliveryId"),
      authorization: DesktopAuthClaimExchangeAuthorization.fromJson(_asMap(_requiredKey(json, "authorization", "DesktopAuthClaimExchangeReauthorizationResponse"), "DesktopAuthClaimExchangeReauthorizationResponse.authorization")),
      deliveryExpiresAt: _asString(_requiredKey(json, "deliveryExpiresAt", "DesktopAuthClaimExchangeReauthorizationResponse"), "DesktopAuthClaimExchangeReauthorizationResponse.deliveryExpiresAt"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "flowId": flowId,
      "phase": phase,
      "deliveryKind": deliveryKind,
      "deliveryId": deliveryId,
      "authorization": authorization.toJson(),
      "deliveryExpiresAt": deliveryExpiresAt,
    };
    return json;
  }
}

sealed class DesktopAuthClaimExchange {
  const DesktopAuthClaimExchange();

  factory DesktopAuthClaimExchange.fromJson(Map<String, Object?> json) {
    switch (json["deliveryKind"]) {
      case "request":
        return DesktopAuthClaimExchangeRequest.fromJson(json);
      case "session":
        return DesktopAuthClaimExchangeSessionResponse.fromJson(json);
      case "reauthorization":
        return DesktopAuthClaimExchangeReauthorizationResponse.fromJson(json);
      default:
        throw FormatException('DesktopAuthClaimExchange.deliveryKind has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class DesktopAuthConfirmExchangeRequest extends DesktopAuthConfirmExchange {
  final String contract;
  final String message;
  final String flowId;
  final String verifier;
  final String deliveryId;

  const DesktopAuthConfirmExchangeRequest({
    required this.contract,
    required this.message,
    required this.flowId,
    required this.verifier,
    required this.deliveryId,
  }) : super();

  factory DesktopAuthConfirmExchangeRequest.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "flowId", "verifier", "deliveryId"}, "DesktopAuthConfirmExchangeRequest");
    return DesktopAuthConfirmExchangeRequest(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopAuthConfirmExchangeRequest"), "desktop-auth.confirm@1", "DesktopAuthConfirmExchangeRequest.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopAuthConfirmExchangeRequest"), "request", "DesktopAuthConfirmExchangeRequest.message"),
      flowId: _asString(_requiredKey(json, "flowId", "DesktopAuthConfirmExchangeRequest"), "DesktopAuthConfirmExchangeRequest.flowId"),
      verifier: _asString(_requiredKey(json, "verifier", "DesktopAuthConfirmExchangeRequest"), "DesktopAuthConfirmExchangeRequest.verifier"),
      deliveryId: _asString(_requiredKey(json, "deliveryId", "DesktopAuthConfirmExchangeRequest"), "DesktopAuthConfirmExchangeRequest.deliveryId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "flowId": flowId,
      "verifier": verifier,
      "deliveryId": deliveryId,
    };
    return json;
  }
}

class DesktopAuthConfirmExchangeResponse extends DesktopAuthConfirmExchange {
  final String contract;
  final String message;
  final String flowId;
  final String phase;
  final String sessionId;
  final String confirmedAt;

  const DesktopAuthConfirmExchangeResponse({
    required this.contract,
    required this.message,
    required this.flowId,
    required this.phase,
    required this.sessionId,
    required this.confirmedAt,
  }) : super();

  factory DesktopAuthConfirmExchangeResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "flowId", "phase", "sessionId", "confirmedAt"}, "DesktopAuthConfirmExchangeResponse");
    return DesktopAuthConfirmExchangeResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopAuthConfirmExchangeResponse"), "desktop-auth.confirm@1", "DesktopAuthConfirmExchangeResponse.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopAuthConfirmExchangeResponse"), "response", "DesktopAuthConfirmExchangeResponse.message"),
      flowId: _asString(_requiredKey(json, "flowId", "DesktopAuthConfirmExchangeResponse"), "DesktopAuthConfirmExchangeResponse.flowId"),
      phase: _expectStringConst(_requiredKey(json, "phase", "DesktopAuthConfirmExchangeResponse"), "confirmed", "DesktopAuthConfirmExchangeResponse.phase"),
      sessionId: _asString(_requiredKey(json, "sessionId", "DesktopAuthConfirmExchangeResponse"), "DesktopAuthConfirmExchangeResponse.sessionId"),
      confirmedAt: _asString(_requiredKey(json, "confirmedAt", "DesktopAuthConfirmExchangeResponse"), "DesktopAuthConfirmExchangeResponse.confirmedAt"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "flowId": flowId,
      "phase": phase,
      "sessionId": sessionId,
      "confirmedAt": confirmedAt,
    };
    return json;
  }
}

sealed class DesktopAuthConfirmExchange {
  const DesktopAuthConfirmExchange();

  factory DesktopAuthConfirmExchange.fromJson(Map<String, Object?> json) {
    switch (json["message"]) {
      case "request":
        return DesktopAuthConfirmExchangeRequest.fromJson(json);
      case "response":
        return DesktopAuthConfirmExchangeResponse.fromJson(json);
      default:
        throw FormatException('DesktopAuthConfirmExchange.message has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class DesktopAuthCancelExchangeRequest extends DesktopAuthCancelExchange {
  final String contract;
  final String message;
  final String flowId;
  final String verifier;

  const DesktopAuthCancelExchangeRequest({
    required this.contract,
    required this.message,
    required this.flowId,
    required this.verifier,
  }) : super();

  factory DesktopAuthCancelExchangeRequest.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "flowId", "verifier"}, "DesktopAuthCancelExchangeRequest");
    return DesktopAuthCancelExchangeRequest(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopAuthCancelExchangeRequest"), "desktop-auth.cancel@1", "DesktopAuthCancelExchangeRequest.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopAuthCancelExchangeRequest"), "request", "DesktopAuthCancelExchangeRequest.message"),
      flowId: _asString(_requiredKey(json, "flowId", "DesktopAuthCancelExchangeRequest"), "DesktopAuthCancelExchangeRequest.flowId"),
      verifier: _asString(_requiredKey(json, "verifier", "DesktopAuthCancelExchangeRequest"), "DesktopAuthCancelExchangeRequest.verifier"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "flowId": flowId,
      "verifier": verifier,
    };
    return json;
  }
}

class DesktopAuthCancelExchangeResponse extends DesktopAuthCancelExchange {
  final String contract;
  final String message;
  final String flowId;
  final String phase;
  final String cancelledAt;

  const DesktopAuthCancelExchangeResponse({
    required this.contract,
    required this.message,
    required this.flowId,
    required this.phase,
    required this.cancelledAt,
  }) : super();

  factory DesktopAuthCancelExchangeResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "flowId", "phase", "cancelledAt"}, "DesktopAuthCancelExchangeResponse");
    return DesktopAuthCancelExchangeResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopAuthCancelExchangeResponse"), "desktop-auth.cancel@1", "DesktopAuthCancelExchangeResponse.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopAuthCancelExchangeResponse"), "response", "DesktopAuthCancelExchangeResponse.message"),
      flowId: _asString(_requiredKey(json, "flowId", "DesktopAuthCancelExchangeResponse"), "DesktopAuthCancelExchangeResponse.flowId"),
      phase: _expectStringConst(_requiredKey(json, "phase", "DesktopAuthCancelExchangeResponse"), "cancelled", "DesktopAuthCancelExchangeResponse.phase"),
      cancelledAt: _asString(_requiredKey(json, "cancelledAt", "DesktopAuthCancelExchangeResponse"), "DesktopAuthCancelExchangeResponse.cancelledAt"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "flowId": flowId,
      "phase": phase,
      "cancelledAt": cancelledAt,
    };
    return json;
  }
}

sealed class DesktopAuthCancelExchange {
  const DesktopAuthCancelExchange();

  factory DesktopAuthCancelExchange.fromJson(Map<String, Object?> json) {
    switch (json["message"]) {
      case "request":
        return DesktopAuthCancelExchangeRequest.fromJson(json);
      case "response":
        return DesktopAuthCancelExchangeResponse.fromJson(json);
      default:
        throw FormatException('DesktopAuthCancelExchange.message has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class DesktopSessionRenewExchangePrepareRequest extends DesktopSessionRenewExchange {
  final String contract;
  final String message;
  final String action;
  final String commandId;

  const DesktopSessionRenewExchangePrepareRequest({
    required this.contract,
    required this.message,
    required this.action,
    required this.commandId,
  }) : super();

  factory DesktopSessionRenewExchangePrepareRequest.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "action", "commandId"}, "DesktopSessionRenewExchangePrepareRequest");
    return DesktopSessionRenewExchangePrepareRequest(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopSessionRenewExchangePrepareRequest"), "desktop-session.renew@1", "DesktopSessionRenewExchangePrepareRequest.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopSessionRenewExchangePrepareRequest"), "request", "DesktopSessionRenewExchangePrepareRequest.message"),
      action: _expectStringConst(_requiredKey(json, "action", "DesktopSessionRenewExchangePrepareRequest"), "prepare", "DesktopSessionRenewExchangePrepareRequest.action"),
      commandId: _asString(_requiredKey(json, "commandId", "DesktopSessionRenewExchangePrepareRequest"), "DesktopSessionRenewExchangePrepareRequest.commandId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "action": action,
      "commandId": commandId,
    };
    return json;
  }
}

class DesktopSessionRenewExchangeSessionPunk {
  final String id;
  final String displayName;
  final String? avatarUrl;

  const DesktopSessionRenewExchangeSessionPunk({
    required this.id,
    required this.displayName,
    required this.avatarUrl,
  });

  factory DesktopSessionRenewExchangeSessionPunk.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"id", "displayName", "avatarUrl"}, "DesktopSessionRenewExchangeSessionPunk");
    return DesktopSessionRenewExchangeSessionPunk(
      id: _asString(_requiredKey(json, "id", "DesktopSessionRenewExchangeSessionPunk"), "DesktopSessionRenewExchangeSessionPunk.id"),
      displayName: _asString(_requiredKey(json, "displayName", "DesktopSessionRenewExchangeSessionPunk"), "DesktopSessionRenewExchangeSessionPunk.displayName"),
      avatarUrl: _requiredKey(json, "avatarUrl", "DesktopSessionRenewExchangeSessionPunk") == null ? null : _asString(_requiredKey(json, "avatarUrl", "DesktopSessionRenewExchangeSessionPunk"), "DesktopSessionRenewExchangeSessionPunk.avatarUrl"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "id": id,
      "displayName": displayName,
      "avatarUrl": avatarUrl == null ? null : avatarUrl!,
    };
    return json;
  }
}

class DesktopSessionRenewExchangeSession {
  final String sessionId;
  final String punkId;
  final String authenticatedAt;
  final String expiresAt;
  final String? recentReauthUntil;
  final DesktopSessionRenewExchangeSessionPunk punk;

  const DesktopSessionRenewExchangeSession({
    required this.sessionId,
    required this.punkId,
    required this.authenticatedAt,
    required this.expiresAt,
    required this.recentReauthUntil,
    required this.punk,
  });

  factory DesktopSessionRenewExchangeSession.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"sessionId", "punkId", "authenticatedAt", "expiresAt", "recentReauthUntil", "punk"}, "DesktopSessionRenewExchangeSession");
    return DesktopSessionRenewExchangeSession(
      sessionId: _asString(_requiredKey(json, "sessionId", "DesktopSessionRenewExchangeSession"), "DesktopSessionRenewExchangeSession.sessionId"),
      punkId: _asString(_requiredKey(json, "punkId", "DesktopSessionRenewExchangeSession"), "DesktopSessionRenewExchangeSession.punkId"),
      authenticatedAt: _asString(_requiredKey(json, "authenticatedAt", "DesktopSessionRenewExchangeSession"), "DesktopSessionRenewExchangeSession.authenticatedAt"),
      expiresAt: _asString(_requiredKey(json, "expiresAt", "DesktopSessionRenewExchangeSession"), "DesktopSessionRenewExchangeSession.expiresAt"),
      recentReauthUntil: _requiredKey(json, "recentReauthUntil", "DesktopSessionRenewExchangeSession") == null ? null : _asString(_requiredKey(json, "recentReauthUntil", "DesktopSessionRenewExchangeSession"), "DesktopSessionRenewExchangeSession.recentReauthUntil"),
      punk: DesktopSessionRenewExchangeSessionPunk.fromJson(_asMap(_requiredKey(json, "punk", "DesktopSessionRenewExchangeSession"), "DesktopSessionRenewExchangeSession.punk")),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "sessionId": sessionId,
      "punkId": punkId,
      "authenticatedAt": authenticatedAt,
      "expiresAt": expiresAt,
      "recentReauthUntil": recentReauthUntil == null ? null : recentReauthUntil!,
      "punk": punk.toJson(),
    };
    return json;
  }
}

class DesktopSessionRenewExchangeCapability {
  final String token;
  final String expiresAt;

  const DesktopSessionRenewExchangeCapability({
    required this.token,
    required this.expiresAt,
  });

  factory DesktopSessionRenewExchangeCapability.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"token", "expiresAt"}, "DesktopSessionRenewExchangeCapability");
    return DesktopSessionRenewExchangeCapability(
      token: _asString(_requiredKey(json, "token", "DesktopSessionRenewExchangeCapability"), "DesktopSessionRenewExchangeCapability.token"),
      expiresAt: _asString(_requiredKey(json, "expiresAt", "DesktopSessionRenewExchangeCapability"), "DesktopSessionRenewExchangeCapability.expiresAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "token": token,
      "expiresAt": expiresAt,
    };
    return json;
  }
}

class DesktopSessionRenewExchangePreparedResponse extends DesktopSessionRenewExchange {
  final String contract;
  final String message;
  final String action;
  final String commandId;
  final String rotationId;
  final DesktopSessionRenewExchangeSession session;
  final DesktopSessionRenewExchangeCapability revokeCapability;
  final String confirmBy;

  const DesktopSessionRenewExchangePreparedResponse({
    required this.contract,
    required this.message,
    required this.action,
    required this.commandId,
    required this.rotationId,
    required this.session,
    required this.revokeCapability,
    required this.confirmBy,
  }) : super();

  factory DesktopSessionRenewExchangePreparedResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "action", "commandId", "rotationId", "session", "revokeCapability", "confirmBy"}, "DesktopSessionRenewExchangePreparedResponse");
    return DesktopSessionRenewExchangePreparedResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopSessionRenewExchangePreparedResponse"), "desktop-session.renew@1", "DesktopSessionRenewExchangePreparedResponse.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopSessionRenewExchangePreparedResponse"), "response", "DesktopSessionRenewExchangePreparedResponse.message"),
      action: _expectStringConst(_requiredKey(json, "action", "DesktopSessionRenewExchangePreparedResponse"), "prepared", "DesktopSessionRenewExchangePreparedResponse.action"),
      commandId: _asString(_requiredKey(json, "commandId", "DesktopSessionRenewExchangePreparedResponse"), "DesktopSessionRenewExchangePreparedResponse.commandId"),
      rotationId: _asString(_requiredKey(json, "rotationId", "DesktopSessionRenewExchangePreparedResponse"), "DesktopSessionRenewExchangePreparedResponse.rotationId"),
      session: DesktopSessionRenewExchangeSession.fromJson(_asMap(_requiredKey(json, "session", "DesktopSessionRenewExchangePreparedResponse"), "DesktopSessionRenewExchangePreparedResponse.session")),
      revokeCapability: DesktopSessionRenewExchangeCapability.fromJson(_asMap(_requiredKey(json, "revokeCapability", "DesktopSessionRenewExchangePreparedResponse"), "DesktopSessionRenewExchangePreparedResponse.revokeCapability")),
      confirmBy: _asString(_requiredKey(json, "confirmBy", "DesktopSessionRenewExchangePreparedResponse"), "DesktopSessionRenewExchangePreparedResponse.confirmBy"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "action": action,
      "commandId": commandId,
      "rotationId": rotationId,
      "session": session.toJson(),
      "revokeCapability": revokeCapability.toJson(),
      "confirmBy": confirmBy,
    };
    return json;
  }
}

class DesktopSessionRenewExchangeConfirmRequest extends DesktopSessionRenewExchange {
  final String contract;
  final String message;
  final String action;
  final String commandId;
  final String rotationId;

  const DesktopSessionRenewExchangeConfirmRequest({
    required this.contract,
    required this.message,
    required this.action,
    required this.commandId,
    required this.rotationId,
  }) : super();

  factory DesktopSessionRenewExchangeConfirmRequest.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "action", "commandId", "rotationId"}, "DesktopSessionRenewExchangeConfirmRequest");
    return DesktopSessionRenewExchangeConfirmRequest(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopSessionRenewExchangeConfirmRequest"), "desktop-session.renew@1", "DesktopSessionRenewExchangeConfirmRequest.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopSessionRenewExchangeConfirmRequest"), "request", "DesktopSessionRenewExchangeConfirmRequest.message"),
      action: _expectStringConst(_requiredKey(json, "action", "DesktopSessionRenewExchangeConfirmRequest"), "confirm", "DesktopSessionRenewExchangeConfirmRequest.action"),
      commandId: _asString(_requiredKey(json, "commandId", "DesktopSessionRenewExchangeConfirmRequest"), "DesktopSessionRenewExchangeConfirmRequest.commandId"),
      rotationId: _asString(_requiredKey(json, "rotationId", "DesktopSessionRenewExchangeConfirmRequest"), "DesktopSessionRenewExchangeConfirmRequest.rotationId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "action": action,
      "commandId": commandId,
      "rotationId": rotationId,
    };
    return json;
  }
}

class DesktopSessionRenewExchangeConfirmedResponse extends DesktopSessionRenewExchange {
  final String contract;
  final String message;
  final String action;
  final String commandId;
  final String rotationId;
  final String sessionId;
  final String confirmedAt;

  const DesktopSessionRenewExchangeConfirmedResponse({
    required this.contract,
    required this.message,
    required this.action,
    required this.commandId,
    required this.rotationId,
    required this.sessionId,
    required this.confirmedAt,
  }) : super();

  factory DesktopSessionRenewExchangeConfirmedResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "action", "commandId", "rotationId", "sessionId", "confirmedAt"}, "DesktopSessionRenewExchangeConfirmedResponse");
    return DesktopSessionRenewExchangeConfirmedResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopSessionRenewExchangeConfirmedResponse"), "desktop-session.renew@1", "DesktopSessionRenewExchangeConfirmedResponse.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopSessionRenewExchangeConfirmedResponse"), "response", "DesktopSessionRenewExchangeConfirmedResponse.message"),
      action: _expectStringConst(_requiredKey(json, "action", "DesktopSessionRenewExchangeConfirmedResponse"), "confirmed", "DesktopSessionRenewExchangeConfirmedResponse.action"),
      commandId: _asString(_requiredKey(json, "commandId", "DesktopSessionRenewExchangeConfirmedResponse"), "DesktopSessionRenewExchangeConfirmedResponse.commandId"),
      rotationId: _asString(_requiredKey(json, "rotationId", "DesktopSessionRenewExchangeConfirmedResponse"), "DesktopSessionRenewExchangeConfirmedResponse.rotationId"),
      sessionId: _asString(_requiredKey(json, "sessionId", "DesktopSessionRenewExchangeConfirmedResponse"), "DesktopSessionRenewExchangeConfirmedResponse.sessionId"),
      confirmedAt: _asString(_requiredKey(json, "confirmedAt", "DesktopSessionRenewExchangeConfirmedResponse"), "DesktopSessionRenewExchangeConfirmedResponse.confirmedAt"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "action": action,
      "commandId": commandId,
      "rotationId": rotationId,
      "sessionId": sessionId,
      "confirmedAt": confirmedAt,
    };
    return json;
  }
}

sealed class DesktopSessionRenewExchange {
  const DesktopSessionRenewExchange();

  factory DesktopSessionRenewExchange.fromJson(Map<String, Object?> json) {
    switch (json["action"]) {
      case "prepare":
        return DesktopSessionRenewExchangePrepareRequest.fromJson(json);
      case "prepared":
        return DesktopSessionRenewExchangePreparedResponse.fromJson(json);
      case "confirm":
        return DesktopSessionRenewExchangeConfirmRequest.fromJson(json);
      case "confirmed":
        return DesktopSessionRenewExchangeConfirmedResponse.fromJson(json);
      default:
        throw FormatException('DesktopSessionRenewExchange.action has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class DesktopSessionRevokeExchangeRequest extends DesktopSessionRevokeExchange {
  final String contract;
  final String message;
  final String capability;

  const DesktopSessionRevokeExchangeRequest({
    required this.contract,
    required this.message,
    required this.capability,
  }) : super();

  factory DesktopSessionRevokeExchangeRequest.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "capability"}, "DesktopSessionRevokeExchangeRequest");
    return DesktopSessionRevokeExchangeRequest(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopSessionRevokeExchangeRequest"), "desktop-session.revoke@1", "DesktopSessionRevokeExchangeRequest.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopSessionRevokeExchangeRequest"), "request", "DesktopSessionRevokeExchangeRequest.message"),
      capability: _asString(_requiredKey(json, "capability", "DesktopSessionRevokeExchangeRequest"), "DesktopSessionRevokeExchangeRequest.capability"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "capability": capability,
    };
    return json;
  }
}

class DesktopSessionRevokeExchangeResponse extends DesktopSessionRevokeExchange {
  final String contract;
  final String message;
  final bool revoked;
  final bool expired;

  const DesktopSessionRevokeExchangeResponse({
    required this.contract,
    required this.message,
    required this.revoked,
    required this.expired,
  }) : super();

  factory DesktopSessionRevokeExchangeResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "revoked", "expired"}, "DesktopSessionRevokeExchangeResponse");
    return DesktopSessionRevokeExchangeResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopSessionRevokeExchangeResponse"), "desktop-session.revoke@1", "DesktopSessionRevokeExchangeResponse.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopSessionRevokeExchangeResponse"), "response", "DesktopSessionRevokeExchangeResponse.message"),
      revoked: _expectBoolConst(_requiredKey(json, "revoked", "DesktopSessionRevokeExchangeResponse"), true, "DesktopSessionRevokeExchangeResponse.revoked"),
      expired: _asBool(_requiredKey(json, "expired", "DesktopSessionRevokeExchangeResponse"), "DesktopSessionRevokeExchangeResponse.expired"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "message": message,
      "revoked": revoked,
      "expired": expired,
    };
    return json;
  }
}

sealed class DesktopSessionRevokeExchange {
  const DesktopSessionRevokeExchange();

  factory DesktopSessionRevokeExchange.fromJson(Map<String, Object?> json) {
    switch (json["message"]) {
      case "request":
        return DesktopSessionRevokeExchangeRequest.fromJson(json);
      case "response":
        return DesktopSessionRevokeExchangeResponse.fromJson(json);
      default:
        throw FormatException('DesktopSessionRevokeExchange.message has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class ListWorkspacesQuery {
  final String contract;
  final int limit;
  final String? cursor;

  const ListWorkspacesQuery({
    required this.contract,
    required this.limit,
    required this.cursor,
  });

  factory ListWorkspacesQuery.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "limit", "cursor"}, "ListWorkspacesQuery");
    return ListWorkspacesQuery(
      contract: _expectStringConst(_requiredKey(json, "contract", "ListWorkspacesQuery"), "workspace.list@1", "ListWorkspacesQuery.contract"),
      limit: _asInt(_requiredKey(json, "limit", "ListWorkspacesQuery"), "ListWorkspacesQuery.limit"),
      cursor: _requiredKey(json, "cursor", "ListWorkspacesQuery") == null ? null : _asString(_requiredKey(json, "cursor", "ListWorkspacesQuery"), "ListWorkspacesQuery.cursor"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "limit": limit,
      "cursor": cursor == null ? null : cursor!,
    };
    return json;
  }
}

enum ListWorkspacesResponseWorkspaceSummaryVisibility {
  private("private"),
  punks("punks"),
  public("public"),
  ;

  const ListWorkspacesResponseWorkspaceSummaryVisibility(this.value);

  final String value;

  factory ListWorkspacesResponseWorkspaceSummaryVisibility.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a ListWorkspacesResponseWorkspaceSummaryVisibility value');
  }

  String toJson() => value;
}

enum ListWorkspacesResponseWorkspaceSummaryRole {
  owner("owner"),
  moderator("moderator"),
  member("member"),
  guest("guest"),
  ;

  const ListWorkspacesResponseWorkspaceSummaryRole(this.value);

  final String value;

  factory ListWorkspacesResponseWorkspaceSummaryRole.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a ListWorkspacesResponseWorkspaceSummaryRole value');
  }

  String toJson() => value;
}

class ListWorkspacesResponseWorkspaceSummary {
  final String id;
  final String slug;
  final String name;
  final ListWorkspacesResponseWorkspaceSummaryVisibility visibility;
  final ListWorkspacesResponseWorkspaceSummaryRole role;
  final int revision;

  const ListWorkspacesResponseWorkspaceSummary({
    required this.id,
    required this.slug,
    required this.name,
    required this.visibility,
    required this.role,
    required this.revision,
  });

  factory ListWorkspacesResponseWorkspaceSummary.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"id", "slug", "name", "visibility", "role", "revision"}, "ListWorkspacesResponseWorkspaceSummary");
    return ListWorkspacesResponseWorkspaceSummary(
      id: _asString(_requiredKey(json, "id", "ListWorkspacesResponseWorkspaceSummary"), "ListWorkspacesResponseWorkspaceSummary.id"),
      slug: _asString(_requiredKey(json, "slug", "ListWorkspacesResponseWorkspaceSummary"), "ListWorkspacesResponseWorkspaceSummary.slug"),
      name: _asString(_requiredKey(json, "name", "ListWorkspacesResponseWorkspaceSummary"), "ListWorkspacesResponseWorkspaceSummary.name"),
      visibility: ListWorkspacesResponseWorkspaceSummaryVisibility.fromJson(_requiredKey(json, "visibility", "ListWorkspacesResponseWorkspaceSummary"), "ListWorkspacesResponseWorkspaceSummary.visibility"),
      role: ListWorkspacesResponseWorkspaceSummaryRole.fromJson(_requiredKey(json, "role", "ListWorkspacesResponseWorkspaceSummary"), "ListWorkspacesResponseWorkspaceSummary.role"),
      revision: _asInt(_requiredKey(json, "revision", "ListWorkspacesResponseWorkspaceSummary"), "ListWorkspacesResponseWorkspaceSummary.revision"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "id": id,
      "slug": slug,
      "name": name,
      "visibility": visibility.toJson(),
      "role": role.toJson(),
      "revision": revision,
    };
    return json;
  }
}

class ListWorkspacesResponse {
  final String contract;
  final List<ListWorkspacesResponseWorkspaceSummary> items;
  final String? nextCursor;

  const ListWorkspacesResponse({
    required this.contract,
    required this.items,
    required this.nextCursor,
  });

  factory ListWorkspacesResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "items", "nextCursor"}, "ListWorkspacesResponse");
    return ListWorkspacesResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "ListWorkspacesResponse"), "workspace.list-response@1", "ListWorkspacesResponse.contract"),
      items: _asList(_requiredKey(json, "items", "ListWorkspacesResponse"), "ListWorkspacesResponse.items").map((item) => ListWorkspacesResponseWorkspaceSummary.fromJson(_asMap(item, "ListWorkspacesResponse.items[]"))).toList(growable: false),
      nextCursor: _requiredKey(json, "nextCursor", "ListWorkspacesResponse") == null ? null : _asString(_requiredKey(json, "nextCursor", "ListWorkspacesResponse"), "ListWorkspacesResponse.nextCursor"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "items": items.map((item) => item.toJson()).toList(growable: false),
      "nextCursor": nextCursor == null ? null : nextCursor!,
    };
    return json;
  }
}

class GetWorkspaceQuery {
  final String contract;
  final String workspaceId;

  const GetWorkspaceQuery({
    required this.contract,
    required this.workspaceId,
  });

  factory GetWorkspaceQuery.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspaceId"}, "GetWorkspaceQuery");
    return GetWorkspaceQuery(
      contract: _expectStringConst(_requiredKey(json, "contract", "GetWorkspaceQuery"), "workspace.get@1", "GetWorkspaceQuery.contract"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "GetWorkspaceQuery"), "GetWorkspaceQuery.workspaceId"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspaceId": workspaceId,
    };
    return json;
  }
}

enum WorkspaceVisibility {
  private("private"),
  punks("punks"),
  public("public"),
  ;

  const WorkspaceVisibility(this.value);

  final String value;

  factory WorkspaceVisibility.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a WorkspaceVisibility value');
  }

  String toJson() => value;
}

enum WorkspaceStatus {
  active("active"),
  deleting("deleting"),
  deleted("deleted"),
  ;

  const WorkspaceStatus(this.value);

  final String value;

  factory WorkspaceStatus.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a WorkspaceStatus value');
  }

  String toJson() => value;
}

enum WorkspaceMembersItemRole {
  owner("owner"),
  moderator("moderator"),
  member("member"),
  guest("guest"),
  ;

  const WorkspaceMembersItemRole(this.value);

  final String value;

  factory WorkspaceMembersItemRole.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a WorkspaceMembersItemRole value');
  }

  String toJson() => value;
}

class WorkspaceMembersItem {
  final String punkId;
  final WorkspaceMembersItemRole role;

  const WorkspaceMembersItem({
    required this.punkId,
    required this.role,
  });

  factory WorkspaceMembersItem.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"punkId", "role"}, "WorkspaceMembersItem");
    return WorkspaceMembersItem(
      punkId: _asString(_requiredKey(json, "punkId", "WorkspaceMembersItem"), "WorkspaceMembersItem.punkId"),
      role: WorkspaceMembersItemRole.fromJson(_requiredKey(json, "role", "WorkspaceMembersItem"), "WorkspaceMembersItem.role"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "punkId": punkId,
      "role": role.toJson(),
    };
    return json;
  }
}

class Workspace {
  final String id;
  final String slug;
  final String name;
  final WorkspaceVisibility visibility;
  final WorkspaceStatus status;
  final String ownerPunkId;
  final List<WorkspaceMembersItem> members;
  final int revision;
  final int cursor;
  final String createdAt;
  final String updatedAt;

  const Workspace({
    required this.id,
    required this.slug,
    required this.name,
    required this.visibility,
    required this.status,
    required this.ownerPunkId,
    required this.members,
    required this.revision,
    required this.cursor,
    required this.createdAt,
    required this.updatedAt,
  });

  factory Workspace.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"id", "slug", "name", "visibility", "status", "ownerPunkId", "members", "revision", "cursor", "createdAt", "updatedAt"}, "Workspace");
    return Workspace(
      id: _asString(_requiredKey(json, "id", "Workspace"), "Workspace.id"),
      slug: _asString(_requiredKey(json, "slug", "Workspace"), "Workspace.slug"),
      name: _asString(_requiredKey(json, "name", "Workspace"), "Workspace.name"),
      visibility: WorkspaceVisibility.fromJson(_requiredKey(json, "visibility", "Workspace"), "Workspace.visibility"),
      status: WorkspaceStatus.fromJson(_requiredKey(json, "status", "Workspace"), "Workspace.status"),
      ownerPunkId: _asString(_requiredKey(json, "ownerPunkId", "Workspace"), "Workspace.ownerPunkId"),
      members: _asList(_requiredKey(json, "members", "Workspace"), "Workspace.members").map((item) => WorkspaceMembersItem.fromJson(_asMap(item, "Workspace.members[]"))).toList(growable: false),
      revision: _asInt(_requiredKey(json, "revision", "Workspace"), "Workspace.revision"),
      cursor: _asInt(_requiredKey(json, "cursor", "Workspace"), "Workspace.cursor"),
      createdAt: _asString(_requiredKey(json, "createdAt", "Workspace"), "Workspace.createdAt"),
      updatedAt: _asString(_requiredKey(json, "updatedAt", "Workspace"), "Workspace.updatedAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "id": id,
      "slug": slug,
      "name": name,
      "visibility": visibility.toJson(),
      "status": status.toJson(),
      "ownerPunkId": ownerPunkId,
      "members": members.map((item) => item.toJson()).toList(growable: false),
      "revision": revision,
      "cursor": cursor,
      "createdAt": createdAt,
      "updatedAt": updatedAt,
    };
    return json;
  }
}

class ListConversationsQuery {
  final String contract;
  final String workspaceId;
  final String type;
  final String status;
  final int limit;
  final String? cursor;

  const ListConversationsQuery({
    required this.contract,
    required this.workspaceId,
    required this.type,
    required this.status,
    required this.limit,
    required this.cursor,
  });

  factory ListConversationsQuery.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspaceId", "type", "status", "limit", "cursor"}, "ListConversationsQuery");
    return ListConversationsQuery(
      contract: _expectStringConst(_requiredKey(json, "contract", "ListConversationsQuery"), "conversation.list@1", "ListConversationsQuery.contract"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "ListConversationsQuery"), "ListConversationsQuery.workspaceId"),
      type: _expectStringConst(_requiredKey(json, "type", "ListConversationsQuery"), "stream", "ListConversationsQuery.type"),
      status: _expectStringConst(_requiredKey(json, "status", "ListConversationsQuery"), "active", "ListConversationsQuery.status"),
      limit: _asInt(_requiredKey(json, "limit", "ListConversationsQuery"), "ListConversationsQuery.limit"),
      cursor: _requiredKey(json, "cursor", "ListConversationsQuery") == null ? null : _asString(_requiredKey(json, "cursor", "ListConversationsQuery"), "ListConversationsQuery.cursor"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspaceId": workspaceId,
      "type": type,
      "status": status,
      "limit": limit,
      "cursor": cursor == null ? null : cursor!,
    };
    return json;
  }
}

enum ListConversationsResponseConversationSummaryVisibility {
  open("open"),
  private("private"),
  ;

  const ListConversationsResponseConversationSummaryVisibility(this.value);

  final String value;

  factory ListConversationsResponseConversationSummaryVisibility.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a ListConversationsResponseConversationSummaryVisibility value');
  }

  String toJson() => value;
}

class ListConversationsResponseConversationSummary {
  final String id;
  final String workspaceId;
  final String name;
  final String type;
  final ListConversationsResponseConversationSummaryVisibility visibility;
  final String? description;
  final String? topic;
  final String? purpose;
  final bool topicRequired;
  final int? ttlSeconds;
  final String? ttlDeadline;
  final int revision;
  final int cursor;
  final String updatedAt;

  const ListConversationsResponseConversationSummary({
    required this.id,
    required this.workspaceId,
    required this.name,
    required this.type,
    required this.visibility,
    required this.description,
    required this.topic,
    required this.purpose,
    required this.topicRequired,
    required this.ttlSeconds,
    required this.ttlDeadline,
    required this.revision,
    required this.cursor,
    required this.updatedAt,
  });

  factory ListConversationsResponseConversationSummary.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"id", "workspaceId", "name", "type", "visibility", "description", "topic", "purpose", "topicRequired", "ttlSeconds", "ttlDeadline", "revision", "cursor", "updatedAt"}, "ListConversationsResponseConversationSummary");
    return ListConversationsResponseConversationSummary(
      id: _asString(_requiredKey(json, "id", "ListConversationsResponseConversationSummary"), "ListConversationsResponseConversationSummary.id"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "ListConversationsResponseConversationSummary"), "ListConversationsResponseConversationSummary.workspaceId"),
      name: _asString(_requiredKey(json, "name", "ListConversationsResponseConversationSummary"), "ListConversationsResponseConversationSummary.name"),
      type: _expectStringConst(_requiredKey(json, "type", "ListConversationsResponseConversationSummary"), "stream", "ListConversationsResponseConversationSummary.type"),
      visibility: ListConversationsResponseConversationSummaryVisibility.fromJson(_requiredKey(json, "visibility", "ListConversationsResponseConversationSummary"), "ListConversationsResponseConversationSummary.visibility"),
      description: _requiredKey(json, "description", "ListConversationsResponseConversationSummary") == null ? null : _asString(_requiredKey(json, "description", "ListConversationsResponseConversationSummary"), "ListConversationsResponseConversationSummary.description"),
      topic: _requiredKey(json, "topic", "ListConversationsResponseConversationSummary") == null ? null : _asString(_requiredKey(json, "topic", "ListConversationsResponseConversationSummary"), "ListConversationsResponseConversationSummary.topic"),
      purpose: _requiredKey(json, "purpose", "ListConversationsResponseConversationSummary") == null ? null : _asString(_requiredKey(json, "purpose", "ListConversationsResponseConversationSummary"), "ListConversationsResponseConversationSummary.purpose"),
      topicRequired: _asBool(_requiredKey(json, "topicRequired", "ListConversationsResponseConversationSummary"), "ListConversationsResponseConversationSummary.topicRequired"),
      ttlSeconds: _requiredKey(json, "ttlSeconds", "ListConversationsResponseConversationSummary") == null ? null : _asInt(_requiredKey(json, "ttlSeconds", "ListConversationsResponseConversationSummary"), "ListConversationsResponseConversationSummary.ttlSeconds"),
      ttlDeadline: _requiredKey(json, "ttlDeadline", "ListConversationsResponseConversationSummary") == null ? null : _asString(_requiredKey(json, "ttlDeadline", "ListConversationsResponseConversationSummary"), "ListConversationsResponseConversationSummary.ttlDeadline"),
      revision: _asInt(_requiredKey(json, "revision", "ListConversationsResponseConversationSummary"), "ListConversationsResponseConversationSummary.revision"),
      cursor: _asInt(_requiredKey(json, "cursor", "ListConversationsResponseConversationSummary"), "ListConversationsResponseConversationSummary.cursor"),
      updatedAt: _asString(_requiredKey(json, "updatedAt", "ListConversationsResponseConversationSummary"), "ListConversationsResponseConversationSummary.updatedAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "id": id,
      "workspaceId": workspaceId,
      "name": name,
      "type": type,
      "visibility": visibility.toJson(),
      "description": description == null ? null : description!,
      "topic": topic == null ? null : topic!,
      "purpose": purpose == null ? null : purpose!,
      "topicRequired": topicRequired,
      "ttlSeconds": ttlSeconds == null ? null : ttlSeconds!,
      "ttlDeadline": ttlDeadline == null ? null : ttlDeadline!,
      "revision": revision,
      "cursor": cursor,
      "updatedAt": updatedAt,
    };
    return json;
  }
}

class ListConversationsResponse {
  final String contract;
  final String workspaceId;
  final List<ListConversationsResponseConversationSummary> items;
  final String? nextCursor;

  const ListConversationsResponse({
    required this.contract,
    required this.workspaceId,
    required this.items,
    required this.nextCursor,
  });

  factory ListConversationsResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspaceId", "items", "nextCursor"}, "ListConversationsResponse");
    return ListConversationsResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "ListConversationsResponse"), "conversation.list-response@1", "ListConversationsResponse.contract"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "ListConversationsResponse"), "ListConversationsResponse.workspaceId"),
      items: _asList(_requiredKey(json, "items", "ListConversationsResponse"), "ListConversationsResponse.items").map((item) => ListConversationsResponseConversationSummary.fromJson(_asMap(item, "ListConversationsResponse.items[]"))).toList(growable: false),
      nextCursor: _requiredKey(json, "nextCursor", "ListConversationsResponse") == null ? null : _asString(_requiredKey(json, "nextCursor", "ListConversationsResponse"), "ListConversationsResponse.nextCursor"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspaceId": workspaceId,
      "items": items.map((item) => item.toJson()).toList(growable: false),
      "nextCursor": nextCursor == null ? null : nextCursor!,
    };
    return json;
  }
}

class GetConversationQuery {
  final String contract;
  final String workspaceId;
  final String conversationId;

  const GetConversationQuery({
    required this.contract,
    required this.workspaceId,
    required this.conversationId,
  });

  factory GetConversationQuery.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspaceId", "conversationId"}, "GetConversationQuery");
    return GetConversationQuery(
      contract: _expectStringConst(_requiredKey(json, "contract", "GetConversationQuery"), "conversation.get@1", "GetConversationQuery.contract"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "GetConversationQuery"), "GetConversationQuery.workspaceId"),
      conversationId: _asString(_requiredKey(json, "conversationId", "GetConversationQuery"), "GetConversationQuery.conversationId"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspaceId": workspaceId,
      "conversationId": conversationId,
    };
    return json;
  }
}

enum ConversationViewType {
  stream("stream"),
  forum("forum"),
  dm("dm"),
  workflow("workflow"),
  ;

  const ConversationViewType(this.value);

  final String value;

  factory ConversationViewType.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a ConversationViewType value');
  }

  String toJson() => value;
}

enum ConversationViewVisibility {
  open("open"),
  private("private"),
  ;

  const ConversationViewVisibility(this.value);

  final String value;

  factory ConversationViewVisibility.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a ConversationViewVisibility value');
  }

  String toJson() => value;
}

enum ConversationViewStatus {
  active("active"),
  archived("archived"),
  deleting("deleting"),
  deleted("deleted"),
  ;

  const ConversationViewStatus(this.value);

  final String value;

  factory ConversationViewStatus.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a ConversationViewStatus value');
  }

  String toJson() => value;
}

class ConversationView {
  final String id;
  final String workspaceId;
  final String name;
  final ConversationViewType type;
  final ConversationViewVisibility visibility;
  final String? description;
  final String? topic;
  final String? purpose;
  final bool topicRequired;
  final int? maxMembers;
  final int? ttlSeconds;
  final String? ttlDeadline;
  final ConversationViewStatus status;
  final int revision;
  final int cursor;
  final String createdAt;
  final String updatedAt;
  final String? archivedAt;

  const ConversationView({
    required this.id,
    required this.workspaceId,
    required this.name,
    required this.type,
    required this.visibility,
    required this.description,
    required this.topic,
    required this.purpose,
    required this.topicRequired,
    required this.maxMembers,
    required this.ttlSeconds,
    required this.ttlDeadline,
    required this.status,
    required this.revision,
    required this.cursor,
    required this.createdAt,
    required this.updatedAt,
    required this.archivedAt,
  });

  factory ConversationView.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"id", "workspaceId", "name", "type", "visibility", "description", "topic", "purpose", "topicRequired", "maxMembers", "ttlSeconds", "ttlDeadline", "status", "revision", "cursor", "createdAt", "updatedAt", "archivedAt"}, "ConversationView");
    return ConversationView(
      id: _asString(_requiredKey(json, "id", "ConversationView"), "ConversationView.id"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "ConversationView"), "ConversationView.workspaceId"),
      name: _asString(_requiredKey(json, "name", "ConversationView"), "ConversationView.name"),
      type: ConversationViewType.fromJson(_requiredKey(json, "type", "ConversationView"), "ConversationView.type"),
      visibility: ConversationViewVisibility.fromJson(_requiredKey(json, "visibility", "ConversationView"), "ConversationView.visibility"),
      description: _requiredKey(json, "description", "ConversationView") == null ? null : _asString(_requiredKey(json, "description", "ConversationView"), "ConversationView.description"),
      topic: _requiredKey(json, "topic", "ConversationView") == null ? null : _asString(_requiredKey(json, "topic", "ConversationView"), "ConversationView.topic"),
      purpose: _requiredKey(json, "purpose", "ConversationView") == null ? null : _asString(_requiredKey(json, "purpose", "ConversationView"), "ConversationView.purpose"),
      topicRequired: _asBool(_requiredKey(json, "topicRequired", "ConversationView"), "ConversationView.topicRequired"),
      maxMembers: _requiredKey(json, "maxMembers", "ConversationView") == null ? null : _asInt(_requiredKey(json, "maxMembers", "ConversationView"), "ConversationView.maxMembers"),
      ttlSeconds: _requiredKey(json, "ttlSeconds", "ConversationView") == null ? null : _asInt(_requiredKey(json, "ttlSeconds", "ConversationView"), "ConversationView.ttlSeconds"),
      ttlDeadline: _requiredKey(json, "ttlDeadline", "ConversationView") == null ? null : _asString(_requiredKey(json, "ttlDeadline", "ConversationView"), "ConversationView.ttlDeadline"),
      status: ConversationViewStatus.fromJson(_requiredKey(json, "status", "ConversationView"), "ConversationView.status"),
      revision: _asInt(_requiredKey(json, "revision", "ConversationView"), "ConversationView.revision"),
      cursor: _asInt(_requiredKey(json, "cursor", "ConversationView"), "ConversationView.cursor"),
      createdAt: _asString(_requiredKey(json, "createdAt", "ConversationView"), "ConversationView.createdAt"),
      updatedAt: _asString(_requiredKey(json, "updatedAt", "ConversationView"), "ConversationView.updatedAt"),
      archivedAt: _requiredKey(json, "archivedAt", "ConversationView") == null ? null : _asString(_requiredKey(json, "archivedAt", "ConversationView"), "ConversationView.archivedAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "id": id,
      "workspaceId": workspaceId,
      "name": name,
      "type": type.toJson(),
      "visibility": visibility.toJson(),
      "description": description == null ? null : description!,
      "topic": topic == null ? null : topic!,
      "purpose": purpose == null ? null : purpose!,
      "topicRequired": topicRequired,
      "maxMembers": maxMembers == null ? null : maxMembers!,
      "ttlSeconds": ttlSeconds == null ? null : ttlSeconds!,
      "ttlDeadline": ttlDeadline == null ? null : ttlDeadline!,
      "status": status.toJson(),
      "revision": revision,
      "cursor": cursor,
      "createdAt": createdAt,
      "updatedAt": updatedAt,
      "archivedAt": archivedAt == null ? null : archivedAt!,
    };
    return json;
  }
}

enum MessageHistoryQueryDirection {
  older("older"),
  newer("newer"),
  ;

  const MessageHistoryQueryDirection(this.value);

  final String value;

  factory MessageHistoryQueryDirection.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a MessageHistoryQueryDirection value');
  }

  String toJson() => value;
}

class MessageHistoryQuery {
  final String contract;
  final String workspaceId;
  final String conversationId;
  final String? threadRootMessageId;
  final String? cursor;
  final int limit;
  final MessageHistoryQueryDirection? direction;

  const MessageHistoryQuery({
    required this.contract,
    required this.workspaceId,
    required this.conversationId,
    this.threadRootMessageId,
    required this.cursor,
    required this.limit,
    this.direction,
  });

  factory MessageHistoryQuery.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspaceId", "conversationId", "threadRootMessageId", "cursor", "limit", "direction"}, "MessageHistoryQuery");
    if (!((<bool>[_hasKey(json, "direction") && (!_hasKey(json, "cursor") || ((_valueAt(json, "cursor") == null))) && (!_hasKey(json, "direction") || (const <Object?>["older", "newer"].contains(_valueAt(json, "direction")))), (!_hasKey(json, "cursor") || ((_valueAt(json, "cursor") is String))) && !(_hasKey(json, "direction"))].where((match) => match).length == 1))) {
      throw FormatException("MessageHistoryQuery violates its structural alternatives");
    }
    return MessageHistoryQuery(
      contract: _expectStringConst(_requiredKey(json, "contract", "MessageHistoryQuery"), "message.history@1", "MessageHistoryQuery.contract"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "MessageHistoryQuery"), "MessageHistoryQuery.workspaceId"),
      conversationId: _asString(_requiredKey(json, "conversationId", "MessageHistoryQuery"), "MessageHistoryQuery.conversationId"),
      threadRootMessageId: json.containsKey("threadRootMessageId") ? _asString(json["threadRootMessageId"], "MessageHistoryQuery.threadRootMessageId") : null,
      cursor: _requiredKey(json, "cursor", "MessageHistoryQuery") == null ? null : _asString(_requiredKey(json, "cursor", "MessageHistoryQuery"), "MessageHistoryQuery.cursor"),
      limit: _asInt(_requiredKey(json, "limit", "MessageHistoryQuery"), "MessageHistoryQuery.limit"),
      direction: json.containsKey("direction") ? MessageHistoryQueryDirection.fromJson(json["direction"], "MessageHistoryQuery.direction") : null,
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspaceId": workspaceId,
      "conversationId": conversationId,
      "cursor": cursor == null ? null : cursor!,
      "limit": limit,
    };
    if (threadRootMessageId != null) {
      json["threadRootMessageId"] = threadRootMessageId!;
    }
    if (direction != null) {
      json["direction"] = direction!.toJson();
    }
    return json;
  }
}

class MessageViewActorPunk extends MessageViewActor {
  final String kind;
  final String punkId;

  const MessageViewActorPunk({
    required this.kind,
    required this.punkId,
  }) : super();

  factory MessageViewActorPunk.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "MessageViewActorPunk");
    return MessageViewActorPunk(
      kind: _expectStringConst(_requiredKey(json, "kind", "MessageViewActorPunk"), "punk", "MessageViewActorPunk.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "MessageViewActorPunk"), "MessageViewActorPunk.punkId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

class MessageViewActorBot extends MessageViewActor {
  final String kind;
  final String installationId;

  const MessageViewActorBot({
    required this.kind,
    required this.installationId,
  }) : super();

  factory MessageViewActorBot.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "installationId"}, "MessageViewActorBot");
    return MessageViewActorBot(
      kind: _expectStringConst(_requiredKey(json, "kind", "MessageViewActorBot"), "bot", "MessageViewActorBot.kind"),
      installationId: _asString(_requiredKey(json, "installationId", "MessageViewActorBot"), "MessageViewActorBot.installationId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "installationId": installationId,
    };
    return json;
  }
}

sealed class MessageViewActor {
  const MessageViewActor();

  factory MessageViewActor.fromJson(Map<String, Object?> json) {
    switch (json["kind"]) {
      case "punk":
        return MessageViewActorPunk.fromJson(json);
      case "bot":
        return MessageViewActorBot.fromJson(json);
      default:
        throw FormatException('MessageViewActor.kind has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

enum MessageViewMessageType {
  streamMessage("stream-message"),
  forumPost("forum-post"),
  forumComment("forum-comment"),
  ;

  const MessageViewMessageType(this.value);

  final String value;

  factory MessageViewMessageType.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a MessageViewMessageType value');
  }

  String toJson() => value;
}

enum MessageViewStatus {
  active("active"),
  retracted("retracted"),
  erased("erased"),
  ;

  const MessageViewStatus(this.value);

  final String value;

  factory MessageViewStatus.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a MessageViewStatus value');
  }

  String toJson() => value;
}

enum MessageViewRetractionKind {
  author("author"),
  moderation("moderation"),
  ;

  const MessageViewRetractionKind(this.value);

  final String value;

  factory MessageViewRetractionKind.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a MessageViewRetractionKind value');
  }

  String toJson() => value;
}

class MessageView {
  final String id;
  final String workspaceId;
  final String conversationId;
  final MessageViewActor author;
  final MessageViewMessageType messageType;
  final MessageViewStatus status;
  final String? content;
  final String? topic;
  final List<String> mentionedPunkIds;
  final List<String> mediaIds;
  final String? parentMessageId;
  final String threadRootMessageId;
  final int threadDepth;
  final bool broadcast;
  final int replyCount;
  final int descendantCount;
  final String? lastReplyAt;
  final int? currentVersion;
  final MessageViewRetractionKind? retractionKind;
  final String? retractedAt;
  final String? eraseAfter;
  final String? publicReason;
  final String? erasedAt;
  final int revision;
  final int createdCursor;
  final int cursor;
  final String createdAt;
  final String updatedAt;
  final String? editedAt;

  const MessageView({
    required this.id,
    required this.workspaceId,
    required this.conversationId,
    required this.author,
    required this.messageType,
    required this.status,
    required this.content,
    required this.topic,
    required this.mentionedPunkIds,
    required this.mediaIds,
    required this.parentMessageId,
    required this.threadRootMessageId,
    required this.threadDepth,
    required this.broadcast,
    required this.replyCount,
    required this.descendantCount,
    required this.lastReplyAt,
    required this.currentVersion,
    required this.retractionKind,
    required this.retractedAt,
    required this.eraseAfter,
    required this.publicReason,
    required this.erasedAt,
    required this.revision,
    required this.createdCursor,
    required this.cursor,
    required this.createdAt,
    required this.updatedAt,
    required this.editedAt,
  });

  factory MessageView.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"id", "workspaceId", "conversationId", "author", "messageType", "status", "content", "topic", "mentionedPunkIds", "mediaIds", "parentMessageId", "threadRootMessageId", "threadDepth", "broadcast", "replyCount", "descendantCount", "lastReplyAt", "currentVersion", "retractionKind", "retractedAt", "eraseAfter", "publicReason", "erasedAt", "revision", "createdCursor", "cursor", "createdAt", "updatedAt", "editedAt"}, "MessageView");
    if (!(((((!_hasKey(json, "status") || (_valueAt(json, "status") == "active"))) ? ((!_hasKey(json, "content") || ((_valueAt(json, "content") is String))) && (!_hasKey(json, "currentVersion") || ((_valueAt(json, "currentVersion") is int))) && (!_hasKey(json, "retractionKind") || ((_valueAt(json, "retractionKind") == null))) && (!_hasKey(json, "retractedAt") || ((_valueAt(json, "retractedAt") == null))) && (!_hasKey(json, "eraseAfter") || ((_valueAt(json, "eraseAfter") == null))) && (!_hasKey(json, "publicReason") || ((_valueAt(json, "publicReason") == null))) && (!_hasKey(json, "erasedAt") || ((_valueAt(json, "erasedAt") == null)))) : (true))) && ((((!_hasKey(json, "status") || (_valueAt(json, "status") == "retracted"))) ? ((!_hasKey(json, "content") || ((_valueAt(json, "content") == null))) && (!_hasKey(json, "topic") || ((_valueAt(json, "topic") == null))) && (!_hasKey(json, "currentVersion") || ((_valueAt(json, "currentVersion") == null))) && (!_hasKey(json, "mediaIds") || ((_valueAt(json, "mediaIds") is List<Object?>))) && (!_hasKey(json, "retractionKind") || (const <Object?>["author", "moderation"].contains(_valueAt(json, "retractionKind")))) && (!_hasKey(json, "retractedAt") || ((_valueAt(json, "retractedAt") is String))) && (!_hasKey(json, "eraseAfter") || ((_valueAt(json, "eraseAfter") is String))) && (!_hasKey(json, "erasedAt") || ((_valueAt(json, "erasedAt") == null)))) : (true))) && ((((!_hasKey(json, "status") || (_valueAt(json, "status") == "erased"))) ? ((!_hasKey(json, "content") || ((_valueAt(json, "content") == null))) && (!_hasKey(json, "topic") || ((_valueAt(json, "topic") == null))) && (!_hasKey(json, "currentVersion") || ((_valueAt(json, "currentVersion") == null))) && (!_hasKey(json, "mediaIds") || ((_valueAt(json, "mediaIds") is List<Object?>))) && (!_hasKey(json, "retractionKind") || (const <Object?>["author", "moderation"].contains(_valueAt(json, "retractionKind")))) && (!_hasKey(json, "retractedAt") || ((_valueAt(json, "retractedAt") is String))) && (!_hasKey(json, "eraseAfter") || ((_valueAt(json, "eraseAfter") == null))) && (!_hasKey(json, "publicReason") || ((_valueAt(json, "publicReason") == null))) && (!_hasKey(json, "erasedAt") || ((_valueAt(json, "erasedAt") is String)))) : (true))))) {
      throw FormatException("MessageView violates its structural alternatives");
    }
    return MessageView(
      id: _asString(_requiredKey(json, "id", "MessageView"), "MessageView.id"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "MessageView"), "MessageView.workspaceId"),
      conversationId: _asString(_requiredKey(json, "conversationId", "MessageView"), "MessageView.conversationId"),
      author: MessageViewActor.fromJson(_asMap(_requiredKey(json, "author", "MessageView"), "MessageView.author")),
      messageType: MessageViewMessageType.fromJson(_requiredKey(json, "messageType", "MessageView"), "MessageView.messageType"),
      status: MessageViewStatus.fromJson(_requiredKey(json, "status", "MessageView"), "MessageView.status"),
      content: _requiredKey(json, "content", "MessageView") == null ? null : _asString(_requiredKey(json, "content", "MessageView"), "MessageView.content"),
      topic: _requiredKey(json, "topic", "MessageView") == null ? null : _asString(_requiredKey(json, "topic", "MessageView"), "MessageView.topic"),
      mentionedPunkIds: _asList(_requiredKey(json, "mentionedPunkIds", "MessageView"), "MessageView.mentionedPunkIds").map((item) => _asString(item, "MessageView.mentionedPunkIds[]")).toList(growable: false),
      mediaIds: _asList(_requiredKey(json, "mediaIds", "MessageView"), "MessageView.mediaIds").map((item) => _asString(item, "MessageView.mediaIds[]")).toList(growable: false),
      parentMessageId: _requiredKey(json, "parentMessageId", "MessageView") == null ? null : _asString(_requiredKey(json, "parentMessageId", "MessageView"), "MessageView.parentMessageId"),
      threadRootMessageId: _asString(_requiredKey(json, "threadRootMessageId", "MessageView"), "MessageView.threadRootMessageId"),
      threadDepth: _asInt(_requiredKey(json, "threadDepth", "MessageView"), "MessageView.threadDepth"),
      broadcast: _asBool(_requiredKey(json, "broadcast", "MessageView"), "MessageView.broadcast"),
      replyCount: _asInt(_requiredKey(json, "replyCount", "MessageView"), "MessageView.replyCount"),
      descendantCount: _asInt(_requiredKey(json, "descendantCount", "MessageView"), "MessageView.descendantCount"),
      lastReplyAt: _requiredKey(json, "lastReplyAt", "MessageView") == null ? null : _asString(_requiredKey(json, "lastReplyAt", "MessageView"), "MessageView.lastReplyAt"),
      currentVersion: _requiredKey(json, "currentVersion", "MessageView") == null ? null : _asInt(_requiredKey(json, "currentVersion", "MessageView"), "MessageView.currentVersion"),
      retractionKind: _requiredKey(json, "retractionKind", "MessageView") == null ? null : MessageViewRetractionKind.fromJson(_requiredKey(json, "retractionKind", "MessageView"), "MessageView.retractionKind"),
      retractedAt: _requiredKey(json, "retractedAt", "MessageView") == null ? null : _asString(_requiredKey(json, "retractedAt", "MessageView"), "MessageView.retractedAt"),
      eraseAfter: _requiredKey(json, "eraseAfter", "MessageView") == null ? null : _asString(_requiredKey(json, "eraseAfter", "MessageView"), "MessageView.eraseAfter"),
      publicReason: _requiredKey(json, "publicReason", "MessageView") == null ? null : _asString(_requiredKey(json, "publicReason", "MessageView"), "MessageView.publicReason"),
      erasedAt: _requiredKey(json, "erasedAt", "MessageView") == null ? null : _asString(_requiredKey(json, "erasedAt", "MessageView"), "MessageView.erasedAt"),
      revision: _asInt(_requiredKey(json, "revision", "MessageView"), "MessageView.revision"),
      createdCursor: _asInt(_requiredKey(json, "createdCursor", "MessageView"), "MessageView.createdCursor"),
      cursor: _asInt(_requiredKey(json, "cursor", "MessageView"), "MessageView.cursor"),
      createdAt: _asString(_requiredKey(json, "createdAt", "MessageView"), "MessageView.createdAt"),
      updatedAt: _asString(_requiredKey(json, "updatedAt", "MessageView"), "MessageView.updatedAt"),
      editedAt: _requiredKey(json, "editedAt", "MessageView") == null ? null : _asString(_requiredKey(json, "editedAt", "MessageView"), "MessageView.editedAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "id": id,
      "workspaceId": workspaceId,
      "conversationId": conversationId,
      "author": author.toJson(),
      "messageType": messageType.toJson(),
      "status": status.toJson(),
      "content": content == null ? null : content!,
      "topic": topic == null ? null : topic!,
      "mentionedPunkIds": mentionedPunkIds.map((item) => item).toList(growable: false),
      "mediaIds": mediaIds.map((item) => item).toList(growable: false),
      "parentMessageId": parentMessageId == null ? null : parentMessageId!,
      "threadRootMessageId": threadRootMessageId,
      "threadDepth": threadDepth,
      "broadcast": broadcast,
      "replyCount": replyCount,
      "descendantCount": descendantCount,
      "lastReplyAt": lastReplyAt == null ? null : lastReplyAt!,
      "currentVersion": currentVersion == null ? null : currentVersion!,
      "retractionKind": retractionKind == null ? null : retractionKind!.toJson(),
      "retractedAt": retractedAt == null ? null : retractedAt!,
      "eraseAfter": eraseAfter == null ? null : eraseAfter!,
      "publicReason": publicReason == null ? null : publicReason!,
      "erasedAt": erasedAt == null ? null : erasedAt!,
      "revision": revision,
      "createdCursor": createdCursor,
      "cursor": cursor,
      "createdAt": createdAt,
      "updatedAt": updatedAt,
      "editedAt": editedAt == null ? null : editedAt!,
    };
    return json;
  }
}

class MessageHistoryResponse {
  final String workspaceId;
  final String conversationId;
  final int highWaterCursor;
  final String order;
  final List<MessageView> items;
  final String? nextCursor;

  const MessageHistoryResponse({
    required this.workspaceId,
    required this.conversationId,
    required this.highWaterCursor,
    required this.order,
    required this.items,
    required this.nextCursor,
  });

  factory MessageHistoryResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"workspaceId", "conversationId", "highWaterCursor", "order", "items", "nextCursor"}, "MessageHistoryResponse");
    return MessageHistoryResponse(
      workspaceId: _asString(_requiredKey(json, "workspaceId", "MessageHistoryResponse"), "MessageHistoryResponse.workspaceId"),
      conversationId: _asString(_requiredKey(json, "conversationId", "MessageHistoryResponse"), "MessageHistoryResponse.conversationId"),
      highWaterCursor: _asInt(_requiredKey(json, "highWaterCursor", "MessageHistoryResponse"), "MessageHistoryResponse.highWaterCursor"),
      order: _expectStringConst(_requiredKey(json, "order", "MessageHistoryResponse"), "createdCursor-ascending", "MessageHistoryResponse.order"),
      items: _asList(_requiredKey(json, "items", "MessageHistoryResponse"), "MessageHistoryResponse.items").map((item) => MessageView.fromJson(_asMap(item, "MessageHistoryResponse.items[]"))).toList(growable: false),
      nextCursor: _requiredKey(json, "nextCursor", "MessageHistoryResponse") == null ? null : _asString(_requiredKey(json, "nextCursor", "MessageHistoryResponse"), "MessageHistoryResponse.nextCursor"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "workspaceId": workspaceId,
      "conversationId": conversationId,
      "highWaterCursor": highWaterCursor,
      "order": order,
      "items": items.map((item) => item.toJson()).toList(growable: false),
      "nextCursor": nextCursor == null ? null : nextCursor!,
    };
    return json;
  }
}

class ResolveAuthorsQueryActorPunk extends ResolveAuthorsQueryActor {
  final String kind;
  final String punkId;

  const ResolveAuthorsQueryActorPunk({
    required this.kind,
    required this.punkId,
  }) : super();

  factory ResolveAuthorsQueryActorPunk.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "ResolveAuthorsQueryActorPunk");
    return ResolveAuthorsQueryActorPunk(
      kind: _expectStringConst(_requiredKey(json, "kind", "ResolveAuthorsQueryActorPunk"), "punk", "ResolveAuthorsQueryActorPunk.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "ResolveAuthorsQueryActorPunk"), "ResolveAuthorsQueryActorPunk.punkId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

class ResolveAuthorsQueryActorBot extends ResolveAuthorsQueryActor {
  final String kind;
  final String installationId;

  const ResolveAuthorsQueryActorBot({
    required this.kind,
    required this.installationId,
  }) : super();

  factory ResolveAuthorsQueryActorBot.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "installationId"}, "ResolveAuthorsQueryActorBot");
    return ResolveAuthorsQueryActorBot(
      kind: _expectStringConst(_requiredKey(json, "kind", "ResolveAuthorsQueryActorBot"), "bot", "ResolveAuthorsQueryActorBot.kind"),
      installationId: _asString(_requiredKey(json, "installationId", "ResolveAuthorsQueryActorBot"), "ResolveAuthorsQueryActorBot.installationId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "installationId": installationId,
    };
    return json;
  }
}

sealed class ResolveAuthorsQueryActor {
  const ResolveAuthorsQueryActor();

  factory ResolveAuthorsQueryActor.fromJson(Map<String, Object?> json) {
    switch (json["kind"]) {
      case "punk":
        return ResolveAuthorsQueryActorPunk.fromJson(json);
      case "bot":
        return ResolveAuthorsQueryActorBot.fromJson(json);
      default:
        throw FormatException('ResolveAuthorsQueryActor.kind has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class ResolveAuthorsQuery {
  final String contract;
  final String workspaceId;
  final List<ResolveAuthorsQueryActor> authors;

  const ResolveAuthorsQuery({
    required this.contract,
    required this.workspaceId,
    required this.authors,
  });

  factory ResolveAuthorsQuery.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspaceId", "authors"}, "ResolveAuthorsQuery");
    return ResolveAuthorsQuery(
      contract: _expectStringConst(_requiredKey(json, "contract", "ResolveAuthorsQuery"), "author.resolve@1", "ResolveAuthorsQuery.contract"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "ResolveAuthorsQuery"), "ResolveAuthorsQuery.workspaceId"),
      authors: _asList(_requiredKey(json, "authors", "ResolveAuthorsQuery"), "ResolveAuthorsQuery.authors").map((item) => ResolveAuthorsQueryActor.fromJson(_asMap(item, "ResolveAuthorsQuery.authors[]"))).toList(growable: false),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspaceId": workspaceId,
      "authors": authors.map((item) => item.toJson()).toList(growable: false),
    };
    return json;
  }
}

class ResolveAuthorsResponseAuthorSummaryPunk extends ResolveAuthorsResponseAuthorSummary {
  final String kind;
  final String punkId;
  final String displayName;
  final String? avatarUrl;

  const ResolveAuthorsResponseAuthorSummaryPunk({
    required this.kind,
    required this.punkId,
    required this.displayName,
    required this.avatarUrl,
  }) : super();

  factory ResolveAuthorsResponseAuthorSummaryPunk.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId", "displayName", "avatarUrl"}, "ResolveAuthorsResponseAuthorSummaryPunk");
    return ResolveAuthorsResponseAuthorSummaryPunk(
      kind: _expectStringConst(_requiredKey(json, "kind", "ResolveAuthorsResponseAuthorSummaryPunk"), "punk", "ResolveAuthorsResponseAuthorSummaryPunk.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "ResolveAuthorsResponseAuthorSummaryPunk"), "ResolveAuthorsResponseAuthorSummaryPunk.punkId"),
      displayName: _asString(_requiredKey(json, "displayName", "ResolveAuthorsResponseAuthorSummaryPunk"), "ResolveAuthorsResponseAuthorSummaryPunk.displayName"),
      avatarUrl: _requiredKey(json, "avatarUrl", "ResolveAuthorsResponseAuthorSummaryPunk") == null ? null : _asString(_requiredKey(json, "avatarUrl", "ResolveAuthorsResponseAuthorSummaryPunk"), "ResolveAuthorsResponseAuthorSummaryPunk.avatarUrl"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
      "displayName": displayName,
      "avatarUrl": avatarUrl == null ? null : avatarUrl!,
    };
    return json;
  }
}

class ResolveAuthorsResponseAuthorSummaryBot extends ResolveAuthorsResponseAuthorSummary {
  final String kind;
  final String installationId;
  final String displayName;
  final String? avatarUrl;

  const ResolveAuthorsResponseAuthorSummaryBot({
    required this.kind,
    required this.installationId,
    required this.displayName,
    required this.avatarUrl,
  }) : super();

  factory ResolveAuthorsResponseAuthorSummaryBot.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "installationId", "displayName", "avatarUrl"}, "ResolveAuthorsResponseAuthorSummaryBot");
    return ResolveAuthorsResponseAuthorSummaryBot(
      kind: _expectStringConst(_requiredKey(json, "kind", "ResolveAuthorsResponseAuthorSummaryBot"), "bot", "ResolveAuthorsResponseAuthorSummaryBot.kind"),
      installationId: _asString(_requiredKey(json, "installationId", "ResolveAuthorsResponseAuthorSummaryBot"), "ResolveAuthorsResponseAuthorSummaryBot.installationId"),
      displayName: _asString(_requiredKey(json, "displayName", "ResolveAuthorsResponseAuthorSummaryBot"), "ResolveAuthorsResponseAuthorSummaryBot.displayName"),
      avatarUrl: _requiredKey(json, "avatarUrl", "ResolveAuthorsResponseAuthorSummaryBot") == null ? null : _asString(_requiredKey(json, "avatarUrl", "ResolveAuthorsResponseAuthorSummaryBot"), "ResolveAuthorsResponseAuthorSummaryBot.avatarUrl"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "installationId": installationId,
      "displayName": displayName,
      "avatarUrl": avatarUrl == null ? null : avatarUrl!,
    };
    return json;
  }
}

sealed class ResolveAuthorsResponseAuthorSummary {
  const ResolveAuthorsResponseAuthorSummary();

  factory ResolveAuthorsResponseAuthorSummary.fromJson(Map<String, Object?> json) {
    switch (json["kind"]) {
      case "punk":
        return ResolveAuthorsResponseAuthorSummaryPunk.fromJson(json);
      case "bot":
        return ResolveAuthorsResponseAuthorSummaryBot.fromJson(json);
      default:
        throw FormatException('ResolveAuthorsResponseAuthorSummary.kind has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class ResolveAuthorsResponse {
  final String contract;
  final String workspaceId;
  final List<ResolveAuthorsResponseAuthorSummary> authors;

  const ResolveAuthorsResponse({
    required this.contract,
    required this.workspaceId,
    required this.authors,
  });

  factory ResolveAuthorsResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspaceId", "authors"}, "ResolveAuthorsResponse");
    return ResolveAuthorsResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "ResolveAuthorsResponse"), "author.resolve-response@1", "ResolveAuthorsResponse.contract"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "ResolveAuthorsResponse"), "ResolveAuthorsResponse.workspaceId"),
      authors: _asList(_requiredKey(json, "authors", "ResolveAuthorsResponse"), "ResolveAuthorsResponse.authors").map((item) => ResolveAuthorsResponseAuthorSummary.fromJson(_asMap(item, "ResolveAuthorsResponse.authors[]"))).toList(growable: false),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspaceId": workspaceId,
      "authors": authors.map((item) => item.toJson()).toList(growable: false),
    };
    return json;
  }
}

class FollowConversationQuery {
  final String contract;
  final String workspaceId;
  final String conversationId;
  final int afterCursor;

  const FollowConversationQuery({
    required this.contract,
    required this.workspaceId,
    required this.conversationId,
    required this.afterCursor,
  });

  factory FollowConversationQuery.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspaceId", "conversationId", "afterCursor"}, "FollowConversationQuery");
    return FollowConversationQuery(
      contract: _expectStringConst(_requiredKey(json, "contract", "FollowConversationQuery"), "conversation.follow@1", "FollowConversationQuery.contract"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "FollowConversationQuery"), "FollowConversationQuery.workspaceId"),
      conversationId: _asString(_requiredKey(json, "conversationId", "FollowConversationQuery"), "FollowConversationQuery.conversationId"),
      afterCursor: _asInt(_requiredKey(json, "afterCursor", "FollowConversationQuery"), "FollowConversationQuery.afterCursor"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspaceId": workspaceId,
      "conversationId": conversationId,
      "afterCursor": afterCursor,
    };
    return json;
  }
}

class ConversationFollowServerFrameAccepted extends ConversationFollowServerFrame {
  final int schemaVersion;
  final String type;
  final int resumeAfterCursor;
  final int targetHighWaterCursor;

  const ConversationFollowServerFrameAccepted({
    required this.schemaVersion,
    required this.type,
    required this.resumeAfterCursor,
    required this.targetHighWaterCursor,
  }) : super();

  factory ConversationFollowServerFrameAccepted.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"schemaVersion", "type", "resumeAfterCursor", "targetHighWaterCursor"}, "ConversationFollowServerFrameAccepted");
    return ConversationFollowServerFrameAccepted(
      schemaVersion: _expectIntConst(_requiredKey(json, "schemaVersion", "ConversationFollowServerFrameAccepted"), 1, "ConversationFollowServerFrameAccepted.schemaVersion"),
      type: _expectStringConst(_requiredKey(json, "type", "ConversationFollowServerFrameAccepted"), "accepted", "ConversationFollowServerFrameAccepted.type"),
      resumeAfterCursor: _asInt(_requiredKey(json, "resumeAfterCursor", "ConversationFollowServerFrameAccepted"), "ConversationFollowServerFrameAccepted.resumeAfterCursor"),
      targetHighWaterCursor: _asInt(_requiredKey(json, "targetHighWaterCursor", "ConversationFollowServerFrameAccepted"), "ConversationFollowServerFrameAccepted.targetHighWaterCursor"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "schemaVersion": schemaVersion,
      "type": type,
      "resumeAfterCursor": resumeAfterCursor,
      "targetHighWaterCursor": targetHighWaterCursor,
    };
    return json;
  }
}

class ConversationFollowServerFrameThreadPatch {
  final String messageId;
  final int replyCount;
  final int descendantCount;
  final String? lastReplyAt;
  final int revision;
  final int cursor;

  const ConversationFollowServerFrameThreadPatch({
    required this.messageId,
    required this.replyCount,
    required this.descendantCount,
    required this.lastReplyAt,
    required this.revision,
    required this.cursor,
  });

  factory ConversationFollowServerFrameThreadPatch.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"messageId", "replyCount", "descendantCount", "lastReplyAt", "revision", "cursor"}, "ConversationFollowServerFrameThreadPatch");
    return ConversationFollowServerFrameThreadPatch(
      messageId: _asString(_requiredKey(json, "messageId", "ConversationFollowServerFrameThreadPatch"), "ConversationFollowServerFrameThreadPatch.messageId"),
      replyCount: _asInt(_requiredKey(json, "replyCount", "ConversationFollowServerFrameThreadPatch"), "ConversationFollowServerFrameThreadPatch.replyCount"),
      descendantCount: _asInt(_requiredKey(json, "descendantCount", "ConversationFollowServerFrameThreadPatch"), "ConversationFollowServerFrameThreadPatch.descendantCount"),
      lastReplyAt: _requiredKey(json, "lastReplyAt", "ConversationFollowServerFrameThreadPatch") == null ? null : _asString(_requiredKey(json, "lastReplyAt", "ConversationFollowServerFrameThreadPatch"), "ConversationFollowServerFrameThreadPatch.lastReplyAt"),
      revision: _asInt(_requiredKey(json, "revision", "ConversationFollowServerFrameThreadPatch"), "ConversationFollowServerFrameThreadPatch.revision"),
      cursor: _asInt(_requiredKey(json, "cursor", "ConversationFollowServerFrameThreadPatch"), "ConversationFollowServerFrameThreadPatch.cursor"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "messageId": messageId,
      "replyCount": replyCount,
      "descendantCount": descendantCount,
      "lastReplyAt": lastReplyAt == null ? null : lastReplyAt!,
      "revision": revision,
      "cursor": cursor,
    };
    return json;
  }
}

class ConversationFollowServerFrameReactionPatch {
  final String messageId;
  final String reaction;
  final int count;
  final bool reactedByPunk;
  final int cursor;

  const ConversationFollowServerFrameReactionPatch({
    required this.messageId,
    required this.reaction,
    required this.count,
    required this.reactedByPunk,
    required this.cursor,
  });

  factory ConversationFollowServerFrameReactionPatch.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"messageId", "reaction", "count", "reactedByPunk", "cursor"}, "ConversationFollowServerFrameReactionPatch");
    return ConversationFollowServerFrameReactionPatch(
      messageId: _asString(_requiredKey(json, "messageId", "ConversationFollowServerFrameReactionPatch"), "ConversationFollowServerFrameReactionPatch.messageId"),
      reaction: _asString(_requiredKey(json, "reaction", "ConversationFollowServerFrameReactionPatch"), "ConversationFollowServerFrameReactionPatch.reaction"),
      count: _asInt(_requiredKey(json, "count", "ConversationFollowServerFrameReactionPatch"), "ConversationFollowServerFrameReactionPatch.count"),
      reactedByPunk: _asBool(_requiredKey(json, "reactedByPunk", "ConversationFollowServerFrameReactionPatch"), "ConversationFollowServerFrameReactionPatch.reactedByPunk"),
      cursor: _asInt(_requiredKey(json, "cursor", "ConversationFollowServerFrameReactionPatch"), "ConversationFollowServerFrameReactionPatch.cursor"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "messageId": messageId,
      "reaction": reaction,
      "count": count,
      "reactedByPunk": reactedByPunk,
      "cursor": cursor,
    };
    return json;
  }
}

enum ConversationFollowServerFrameReactionCollectionPatchVisibility {
  visible("visible"),
  temporarilyHidden("temporarily-hidden"),
  permanentlyHidden("permanently-hidden"),
  ;

  const ConversationFollowServerFrameReactionCollectionPatchVisibility(this.value);

  final String value;

  factory ConversationFollowServerFrameReactionCollectionPatchVisibility.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a ConversationFollowServerFrameReactionCollectionPatchVisibility value');
  }

  String toJson() => value;
}

class ConversationFollowServerFrameReactionCollectionPatch {
  final String messageId;
  final ConversationFollowServerFrameReactionCollectionPatchVisibility visibility;
  final int cursor;
  final bool refreshRequired;

  const ConversationFollowServerFrameReactionCollectionPatch({
    required this.messageId,
    required this.visibility,
    required this.cursor,
    required this.refreshRequired,
  });

  factory ConversationFollowServerFrameReactionCollectionPatch.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"messageId", "visibility", "cursor", "refreshRequired"}, "ConversationFollowServerFrameReactionCollectionPatch");
    return ConversationFollowServerFrameReactionCollectionPatch(
      messageId: _asString(_requiredKey(json, "messageId", "ConversationFollowServerFrameReactionCollectionPatch"), "ConversationFollowServerFrameReactionCollectionPatch.messageId"),
      visibility: ConversationFollowServerFrameReactionCollectionPatchVisibility.fromJson(_requiredKey(json, "visibility", "ConversationFollowServerFrameReactionCollectionPatch"), "ConversationFollowServerFrameReactionCollectionPatch.visibility"),
      cursor: _asInt(_requiredKey(json, "cursor", "ConversationFollowServerFrameReactionCollectionPatch"), "ConversationFollowServerFrameReactionCollectionPatch.cursor"),
      refreshRequired: _asBool(_requiredKey(json, "refreshRequired", "ConversationFollowServerFrameReactionCollectionPatch"), "ConversationFollowServerFrameReactionCollectionPatch.refreshRequired"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "messageId": messageId,
      "visibility": visibility.toJson(),
      "cursor": cursor,
      "refreshRequired": refreshRequired,
    };
    return json;
  }
}

class ConversationFollowServerFrameChanges extends ConversationFollowServerFrame {
  final int schemaVersion;
  final String type;
  final int fromExclusiveCursor;
  final int throughCursor;
  final List<MessageView> messages;
  final List<ConversationFollowServerFrameThreadPatch> threadPatches;
  final List<ConversationFollowServerFrameReactionPatch> reactionPatches;
  final List<ConversationFollowServerFrameReactionCollectionPatch> reactionCollectionPatches;

  const ConversationFollowServerFrameChanges({
    required this.schemaVersion,
    required this.type,
    required this.fromExclusiveCursor,
    required this.throughCursor,
    required this.messages,
    required this.threadPatches,
    required this.reactionPatches,
    required this.reactionCollectionPatches,
  }) : super();

  factory ConversationFollowServerFrameChanges.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"schemaVersion", "type", "fromExclusiveCursor", "throughCursor", "messages", "threadPatches", "reactionPatches", "reactionCollectionPatches"}, "ConversationFollowServerFrameChanges");
    return ConversationFollowServerFrameChanges(
      schemaVersion: _expectIntConst(_requiredKey(json, "schemaVersion", "ConversationFollowServerFrameChanges"), 1, "ConversationFollowServerFrameChanges.schemaVersion"),
      type: _expectStringConst(_requiredKey(json, "type", "ConversationFollowServerFrameChanges"), "changes", "ConversationFollowServerFrameChanges.type"),
      fromExclusiveCursor: _asInt(_requiredKey(json, "fromExclusiveCursor", "ConversationFollowServerFrameChanges"), "ConversationFollowServerFrameChanges.fromExclusiveCursor"),
      throughCursor: _asInt(_requiredKey(json, "throughCursor", "ConversationFollowServerFrameChanges"), "ConversationFollowServerFrameChanges.throughCursor"),
      messages: _asList(_requiredKey(json, "messages", "ConversationFollowServerFrameChanges"), "ConversationFollowServerFrameChanges.messages").map((item) => MessageView.fromJson(_asMap(item, "ConversationFollowServerFrameChanges.messages[]"))).toList(growable: false),
      threadPatches: _asList(_requiredKey(json, "threadPatches", "ConversationFollowServerFrameChanges"), "ConversationFollowServerFrameChanges.threadPatches").map((item) => ConversationFollowServerFrameThreadPatch.fromJson(_asMap(item, "ConversationFollowServerFrameChanges.threadPatches[]"))).toList(growable: false),
      reactionPatches: _asList(_requiredKey(json, "reactionPatches", "ConversationFollowServerFrameChanges"), "ConversationFollowServerFrameChanges.reactionPatches").map((item) => ConversationFollowServerFrameReactionPatch.fromJson(_asMap(item, "ConversationFollowServerFrameChanges.reactionPatches[]"))).toList(growable: false),
      reactionCollectionPatches: _asList(_requiredKey(json, "reactionCollectionPatches", "ConversationFollowServerFrameChanges"), "ConversationFollowServerFrameChanges.reactionCollectionPatches").map((item) => ConversationFollowServerFrameReactionCollectionPatch.fromJson(_asMap(item, "ConversationFollowServerFrameChanges.reactionCollectionPatches[]"))).toList(growable: false),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "schemaVersion": schemaVersion,
      "type": type,
      "fromExclusiveCursor": fromExclusiveCursor,
      "throughCursor": throughCursor,
      "messages": messages.map((item) => item.toJson()).toList(growable: false),
      "threadPatches": threadPatches.map((item) => item.toJson()).toList(growable: false),
      "reactionPatches": reactionPatches.map((item) => item.toJson()).toList(growable: false),
      "reactionCollectionPatches": reactionCollectionPatches.map((item) => item.toJson()).toList(growable: false),
    };
    return json;
  }
}

class PresenceTypingPatch {
  final String workspaceId;
  final String conversationId;
  final String punkId;
  final bool active;
  final int leaseGeneration;
  final int sequence;
  final String? expiresAt;

  const PresenceTypingPatch({
    required this.workspaceId,
    required this.conversationId,
    required this.punkId,
    required this.active,
    required this.leaseGeneration,
    required this.sequence,
    required this.expiresAt,
  });

  factory PresenceTypingPatch.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"workspaceId", "conversationId", "punkId", "active", "leaseGeneration", "sequence", "expiresAt"}, "PresenceTypingPatch");
    if (!((((_hasKey(json, "active") && (!_hasKey(json, "active") || (_valueAt(json, "active") == true))) ? ((!_hasKey(json, "expiresAt") || ((_valueAt(json, "expiresAt") is String)))) : ((!_hasKey(json, "expiresAt") || ((_valueAt(json, "expiresAt") == null)))))))) {
      throw FormatException("PresenceTypingPatch violates its structural alternatives");
    }
    return PresenceTypingPatch(
      workspaceId: _asString(_requiredKey(json, "workspaceId", "PresenceTypingPatch"), "PresenceTypingPatch.workspaceId"),
      conversationId: _asString(_requiredKey(json, "conversationId", "PresenceTypingPatch"), "PresenceTypingPatch.conversationId"),
      punkId: _asString(_requiredKey(json, "punkId", "PresenceTypingPatch"), "PresenceTypingPatch.punkId"),
      active: _asBool(_requiredKey(json, "active", "PresenceTypingPatch"), "PresenceTypingPatch.active"),
      leaseGeneration: _asInt(_requiredKey(json, "leaseGeneration", "PresenceTypingPatch"), "PresenceTypingPatch.leaseGeneration"),
      sequence: _asInt(_requiredKey(json, "sequence", "PresenceTypingPatch"), "PresenceTypingPatch.sequence"),
      expiresAt: _requiredKey(json, "expiresAt", "PresenceTypingPatch") == null ? null : _asString(_requiredKey(json, "expiresAt", "PresenceTypingPatch"), "PresenceTypingPatch.expiresAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "workspaceId": workspaceId,
      "conversationId": conversationId,
      "punkId": punkId,
      "active": active,
      "leaseGeneration": leaseGeneration,
      "sequence": sequence,
      "expiresAt": expiresAt == null ? null : expiresAt!,
    };
    return json;
  }
}

class ConversationFollowServerFrameTyping extends ConversationFollowServerFrame {
  final int schemaVersion;
  final String type;
  final PresenceTypingPatch patch;

  const ConversationFollowServerFrameTyping({
    required this.schemaVersion,
    required this.type,
    required this.patch,
  }) : super();

  factory ConversationFollowServerFrameTyping.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"schemaVersion", "type", "patch"}, "ConversationFollowServerFrameTyping");
    return ConversationFollowServerFrameTyping(
      schemaVersion: _expectIntConst(_requiredKey(json, "schemaVersion", "ConversationFollowServerFrameTyping"), 1, "ConversationFollowServerFrameTyping.schemaVersion"),
      type: _expectStringConst(_requiredKey(json, "type", "ConversationFollowServerFrameTyping"), "typing", "ConversationFollowServerFrameTyping.type"),
      patch: PresenceTypingPatch.fromJson(_asMap(_requiredKey(json, "patch", "ConversationFollowServerFrameTyping"), "ConversationFollowServerFrameTyping.patch")),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "schemaVersion": schemaVersion,
      "type": type,
      "patch": patch.toJson(),
    };
    return json;
  }
}

class ConversationFollowServerFrameReady extends ConversationFollowServerFrame {
  final int schemaVersion;
  final String type;
  final int highWaterCursor;

  const ConversationFollowServerFrameReady({
    required this.schemaVersion,
    required this.type,
    required this.highWaterCursor,
  }) : super();

  factory ConversationFollowServerFrameReady.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"schemaVersion", "type", "highWaterCursor"}, "ConversationFollowServerFrameReady");
    return ConversationFollowServerFrameReady(
      schemaVersion: _expectIntConst(_requiredKey(json, "schemaVersion", "ConversationFollowServerFrameReady"), 1, "ConversationFollowServerFrameReady.schemaVersion"),
      type: _expectStringConst(_requiredKey(json, "type", "ConversationFollowServerFrameReady"), "ready", "ConversationFollowServerFrameReady.type"),
      highWaterCursor: _asInt(_requiredKey(json, "highWaterCursor", "ConversationFollowServerFrameReady"), "ConversationFollowServerFrameReady.highWaterCursor"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "schemaVersion": schemaVersion,
      "type": type,
      "highWaterCursor": highWaterCursor,
    };
    return json;
  }
}

enum ConversationFollowServerFrameResyncRequiredReason {
  historyRequired("history_required"),
  slowConsumer("slow_consumer"),
  ;

  const ConversationFollowServerFrameResyncRequiredReason(this.value);

  final String value;

  factory ConversationFollowServerFrameResyncRequiredReason.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a ConversationFollowServerFrameResyncRequiredReason value');
  }

  String toJson() => value;
}

class ConversationFollowServerFrameResyncRequired extends ConversationFollowServerFrame {
  final int schemaVersion;
  final String type;
  final ConversationFollowServerFrameResyncRequiredReason reason;
  final int afterCursor;
  final int highWaterCursor;

  const ConversationFollowServerFrameResyncRequired({
    required this.schemaVersion,
    required this.type,
    required this.reason,
    required this.afterCursor,
    required this.highWaterCursor,
  }) : super();

  factory ConversationFollowServerFrameResyncRequired.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"schemaVersion", "type", "reason", "afterCursor", "highWaterCursor"}, "ConversationFollowServerFrameResyncRequired");
    return ConversationFollowServerFrameResyncRequired(
      schemaVersion: _expectIntConst(_requiredKey(json, "schemaVersion", "ConversationFollowServerFrameResyncRequired"), 1, "ConversationFollowServerFrameResyncRequired.schemaVersion"),
      type: _expectStringConst(_requiredKey(json, "type", "ConversationFollowServerFrameResyncRequired"), "resync-required", "ConversationFollowServerFrameResyncRequired.type"),
      reason: ConversationFollowServerFrameResyncRequiredReason.fromJson(_requiredKey(json, "reason", "ConversationFollowServerFrameResyncRequired"), "ConversationFollowServerFrameResyncRequired.reason"),
      afterCursor: _asInt(_requiredKey(json, "afterCursor", "ConversationFollowServerFrameResyncRequired"), "ConversationFollowServerFrameResyncRequired.afterCursor"),
      highWaterCursor: _asInt(_requiredKey(json, "highWaterCursor", "ConversationFollowServerFrameResyncRequired"), "ConversationFollowServerFrameResyncRequired.highWaterCursor"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "schemaVersion": schemaVersion,
      "type": type,
      "reason": reason.toJson(),
      "afterCursor": afterCursor,
      "highWaterCursor": highWaterCursor,
    };
    return json;
  }
}

class ConversationFollowServerFrameConversationUnavailable extends ConversationFollowServerFrame {
  final int schemaVersion;
  final String type;
  final String reason;
  final int cursor;

  const ConversationFollowServerFrameConversationUnavailable({
    required this.schemaVersion,
    required this.type,
    required this.reason,
    required this.cursor,
  }) : super();

  factory ConversationFollowServerFrameConversationUnavailable.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"schemaVersion", "type", "reason", "cursor"}, "ConversationFollowServerFrameConversationUnavailable");
    return ConversationFollowServerFrameConversationUnavailable(
      schemaVersion: _expectIntConst(_requiredKey(json, "schemaVersion", "ConversationFollowServerFrameConversationUnavailable"), 1, "ConversationFollowServerFrameConversationUnavailable.schemaVersion"),
      type: _expectStringConst(_requiredKey(json, "type", "ConversationFollowServerFrameConversationUnavailable"), "conversation-unavailable", "ConversationFollowServerFrameConversationUnavailable.type"),
      reason: _expectStringConst(_requiredKey(json, "reason", "ConversationFollowServerFrameConversationUnavailable"), "archived", "ConversationFollowServerFrameConversationUnavailable.reason"),
      cursor: _asInt(_requiredKey(json, "cursor", "ConversationFollowServerFrameConversationUnavailable"), "ConversationFollowServerFrameConversationUnavailable.cursor"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "schemaVersion": schemaVersion,
      "type": type,
      "reason": reason,
      "cursor": cursor,
    };
    return json;
  }
}

sealed class ConversationFollowServerFrame {
  const ConversationFollowServerFrame();

  factory ConversationFollowServerFrame.fromJson(Map<String, Object?> json) {
    switch (json["type"]) {
      case "accepted":
        return ConversationFollowServerFrameAccepted.fromJson(json);
      case "changes":
        return ConversationFollowServerFrameChanges.fromJson(json);
      case "typing":
        return ConversationFollowServerFrameTyping.fromJson(json);
      case "ready":
        return ConversationFollowServerFrameReady.fromJson(json);
      case "resync-required":
        return ConversationFollowServerFrameResyncRequired.fromJson(json);
      case "conversation-unavailable":
        return ConversationFollowServerFrameConversationUnavailable.fromJson(json);
      default:
        throw FormatException('ConversationFollowServerFrame.type has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class ConversationFollowClientFrame {
  final int schemaVersion;
  final String type;
  final int throughCursor;

  const ConversationFollowClientFrame({
    required this.schemaVersion,
    required this.type,
    required this.throughCursor,
  });

  factory ConversationFollowClientFrame.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"schemaVersion", "type", "throughCursor"}, "ConversationFollowClientFrame");
    return ConversationFollowClientFrame(
      schemaVersion: _expectIntConst(_requiredKey(json, "schemaVersion", "ConversationFollowClientFrame"), 1, "ConversationFollowClientFrame.schemaVersion"),
      type: _expectStringConst(_requiredKey(json, "type", "ConversationFollowClientFrame"), "ack", "ConversationFollowClientFrame.type"),
      throughCursor: _asInt(_requiredKey(json, "throughCursor", "ConversationFollowClientFrame"), "ConversationFollowClientFrame.throughCursor"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "schemaVersion": schemaVersion,
      "type": type,
      "throughCursor": throughCursor,
    };
    return json;
  }
}

class PostMessageCommandActorPunk extends PostMessageCommandActor {
  final String kind;
  final String punkId;

  const PostMessageCommandActorPunk({
    required this.kind,
    required this.punkId,
  }) : super();

  factory PostMessageCommandActorPunk.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "PostMessageCommandActorPunk");
    return PostMessageCommandActorPunk(
      kind: _expectStringConst(_requiredKey(json, "kind", "PostMessageCommandActorPunk"), "punk", "PostMessageCommandActorPunk.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "PostMessageCommandActorPunk"), "PostMessageCommandActorPunk.punkId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

class PostMessageCommandActorBot extends PostMessageCommandActor {
  final String kind;
  final String installationId;

  const PostMessageCommandActorBot({
    required this.kind,
    required this.installationId,
  }) : super();

  factory PostMessageCommandActorBot.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "installationId"}, "PostMessageCommandActorBot");
    return PostMessageCommandActorBot(
      kind: _expectStringConst(_requiredKey(json, "kind", "PostMessageCommandActorBot"), "bot", "PostMessageCommandActorBot.kind"),
      installationId: _asString(_requiredKey(json, "installationId", "PostMessageCommandActorBot"), "PostMessageCommandActorBot.installationId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "installationId": installationId,
    };
    return json;
  }
}

sealed class PostMessageCommandActor {
  const PostMessageCommandActor();

  factory PostMessageCommandActor.fromJson(Map<String, Object?> json) {
    switch (json["kind"]) {
      case "punk":
        return PostMessageCommandActorPunk.fromJson(json);
      case "bot":
        return PostMessageCommandActorBot.fromJson(json);
      default:
        throw FormatException('PostMessageCommandActor.kind has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class PostMessageCommandPayload {
  final String content;
  final String? replyToMessageId;
  final bool broadcast;
  final String? topic;
  final List<String> mentionedPunkIds;
  final List<String> mediaIds;

  const PostMessageCommandPayload({
    required this.content,
    required this.replyToMessageId,
    required this.broadcast,
    required this.topic,
    required this.mentionedPunkIds,
    required this.mediaIds,
  });

  factory PostMessageCommandPayload.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"content", "replyToMessageId", "broadcast", "topic", "mentionedPunkIds", "mediaIds"}, "PostMessageCommandPayload");
    return PostMessageCommandPayload(
      content: _asString(_requiredKey(json, "content", "PostMessageCommandPayload"), "PostMessageCommandPayload.content"),
      replyToMessageId: _requiredKey(json, "replyToMessageId", "PostMessageCommandPayload") == null ? null : _asString(_requiredKey(json, "replyToMessageId", "PostMessageCommandPayload"), "PostMessageCommandPayload.replyToMessageId"),
      broadcast: _asBool(_requiredKey(json, "broadcast", "PostMessageCommandPayload"), "PostMessageCommandPayload.broadcast"),
      topic: _requiredKey(json, "topic", "PostMessageCommandPayload") == null ? null : _asString(_requiredKey(json, "topic", "PostMessageCommandPayload"), "PostMessageCommandPayload.topic"),
      mentionedPunkIds: _asList(_requiredKey(json, "mentionedPunkIds", "PostMessageCommandPayload"), "PostMessageCommandPayload.mentionedPunkIds").map((item) => _asString(item, "PostMessageCommandPayload.mentionedPunkIds[]")).toList(growable: false),
      mediaIds: _asList(_requiredKey(json, "mediaIds", "PostMessageCommandPayload"), "PostMessageCommandPayload.mediaIds").map((item) => _asString(item, "PostMessageCommandPayload.mediaIds[]")).toList(growable: false),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "content": content,
      "replyToMessageId": replyToMessageId == null ? null : replyToMessageId!,
      "broadcast": broadcast,
      "topic": topic == null ? null : topic!,
      "mentionedPunkIds": mentionedPunkIds.map((item) => item).toList(growable: false),
      "mediaIds": mediaIds.map((item) => item).toList(growable: false),
    };
    return json;
  }
}

class PostMessageCommand {
  final String contract;
  final String commandId;
  final String workspaceId;
  final String conversationId;
  final PostMessageCommandActor actor;
  final PostMessageCommandPayload payload;

  const PostMessageCommand({
    required this.contract,
    required this.commandId,
    required this.workspaceId,
    required this.conversationId,
    required this.actor,
    required this.payload,
  });

  factory PostMessageCommand.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "commandId", "workspaceId", "conversationId", "actor", "payload"}, "PostMessageCommand");
    return PostMessageCommand(
      contract: _expectStringConst(_requiredKey(json, "contract", "PostMessageCommand"), "message.post@1", "PostMessageCommand.contract"),
      commandId: _asString(_requiredKey(json, "commandId", "PostMessageCommand"), "PostMessageCommand.commandId"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "PostMessageCommand"), "PostMessageCommand.workspaceId"),
      conversationId: _asString(_requiredKey(json, "conversationId", "PostMessageCommand"), "PostMessageCommand.conversationId"),
      actor: PostMessageCommandActor.fromJson(_asMap(_requiredKey(json, "actor", "PostMessageCommand"), "PostMessageCommand.actor")),
      payload: PostMessageCommandPayload.fromJson(_asMap(_requiredKey(json, "payload", "PostMessageCommand"), "PostMessageCommand.payload")),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "commandId": commandId,
      "workspaceId": workspaceId,
      "conversationId": conversationId,
      "actor": actor.toJson(),
      "payload": payload.toJson(),
    };
    return json;
  }
}

class PostMessageResponse {
  final MessageView message;
  final bool replayed;

  const PostMessageResponse({
    required this.message,
    required this.replayed,
  });

  factory PostMessageResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"message", "replayed"}, "PostMessageResponse");
    return PostMessageResponse(
      message: MessageView.fromJson(_asMap(_requiredKey(json, "message", "PostMessageResponse"), "PostMessageResponse.message")),
      replayed: _asBool(_requiredKey(json, "replayed", "PostMessageResponse"), "PostMessageResponse.replayed"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "message": message.toJson(),
      "replayed": replayed,
    };
    return json;
  }
}

class AddMessageReactionCommandActorPunk extends AddMessageReactionCommandActor {
  final String kind;
  final String punkId;

  const AddMessageReactionCommandActorPunk({
    required this.kind,
    required this.punkId,
  }) : super();

  factory AddMessageReactionCommandActorPunk.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "AddMessageReactionCommandActorPunk");
    return AddMessageReactionCommandActorPunk(
      kind: _expectStringConst(_requiredKey(json, "kind", "AddMessageReactionCommandActorPunk"), "punk", "AddMessageReactionCommandActorPunk.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "AddMessageReactionCommandActorPunk"), "AddMessageReactionCommandActorPunk.punkId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

class AddMessageReactionCommandActorBot extends AddMessageReactionCommandActor {
  final String kind;
  final String installationId;

  const AddMessageReactionCommandActorBot({
    required this.kind,
    required this.installationId,
  }) : super();

  factory AddMessageReactionCommandActorBot.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "installationId"}, "AddMessageReactionCommandActorBot");
    return AddMessageReactionCommandActorBot(
      kind: _expectStringConst(_requiredKey(json, "kind", "AddMessageReactionCommandActorBot"), "bot", "AddMessageReactionCommandActorBot.kind"),
      installationId: _asString(_requiredKey(json, "installationId", "AddMessageReactionCommandActorBot"), "AddMessageReactionCommandActorBot.installationId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "installationId": installationId,
    };
    return json;
  }
}

sealed class AddMessageReactionCommandActor {
  const AddMessageReactionCommandActor();

  factory AddMessageReactionCommandActor.fromJson(Map<String, Object?> json) {
    switch (json["kind"]) {
      case "punk":
        return AddMessageReactionCommandActorPunk.fromJson(json);
      case "bot":
        return AddMessageReactionCommandActorBot.fromJson(json);
      default:
        throw FormatException('AddMessageReactionCommandActor.kind has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class AddMessageReactionCommandPayload {
  final String reaction;

  const AddMessageReactionCommandPayload({
    required this.reaction,
  });

  factory AddMessageReactionCommandPayload.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"reaction"}, "AddMessageReactionCommandPayload");
    return AddMessageReactionCommandPayload(
      reaction: _asString(_requiredKey(json, "reaction", "AddMessageReactionCommandPayload"), "AddMessageReactionCommandPayload.reaction"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "reaction": reaction,
    };
    return json;
  }
}

class AddMessageReactionCommand {
  final String contract;
  final String commandId;
  final String workspaceId;
  final String conversationId;
  final String messageId;
  final AddMessageReactionCommandActor actor;
  final AddMessageReactionCommandPayload payload;

  const AddMessageReactionCommand({
    required this.contract,
    required this.commandId,
    required this.workspaceId,
    required this.conversationId,
    required this.messageId,
    required this.actor,
    required this.payload,
  });

  factory AddMessageReactionCommand.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "commandId", "workspaceId", "conversationId", "messageId", "actor", "payload"}, "AddMessageReactionCommand");
    return AddMessageReactionCommand(
      contract: _expectStringConst(_requiredKey(json, "contract", "AddMessageReactionCommand"), "message.reaction-add@1", "AddMessageReactionCommand.contract"),
      commandId: _asString(_requiredKey(json, "commandId", "AddMessageReactionCommand"), "AddMessageReactionCommand.commandId"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "AddMessageReactionCommand"), "AddMessageReactionCommand.workspaceId"),
      conversationId: _asString(_requiredKey(json, "conversationId", "AddMessageReactionCommand"), "AddMessageReactionCommand.conversationId"),
      messageId: _asString(_requiredKey(json, "messageId", "AddMessageReactionCommand"), "AddMessageReactionCommand.messageId"),
      actor: AddMessageReactionCommandActor.fromJson(_asMap(_requiredKey(json, "actor", "AddMessageReactionCommand"), "AddMessageReactionCommand.actor")),
      payload: AddMessageReactionCommandPayload.fromJson(_asMap(_requiredKey(json, "payload", "AddMessageReactionCommand"), "AddMessageReactionCommand.payload")),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "commandId": commandId,
      "workspaceId": workspaceId,
      "conversationId": conversationId,
      "messageId": messageId,
      "actor": actor.toJson(),
      "payload": payload.toJson(),
    };
    return json;
  }
}

class MessageReactionMutationResponseActorPunk extends MessageReactionMutationResponseActor {
  final String kind;
  final String punkId;

  const MessageReactionMutationResponseActorPunk({
    required this.kind,
    required this.punkId,
  }) : super();

  factory MessageReactionMutationResponseActorPunk.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "MessageReactionMutationResponseActorPunk");
    return MessageReactionMutationResponseActorPunk(
      kind: _expectStringConst(_requiredKey(json, "kind", "MessageReactionMutationResponseActorPunk"), "punk", "MessageReactionMutationResponseActorPunk.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "MessageReactionMutationResponseActorPunk"), "MessageReactionMutationResponseActorPunk.punkId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

class MessageReactionMutationResponseActorBot extends MessageReactionMutationResponseActor {
  final String kind;
  final String installationId;

  const MessageReactionMutationResponseActorBot({
    required this.kind,
    required this.installationId,
  }) : super();

  factory MessageReactionMutationResponseActorBot.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "installationId"}, "MessageReactionMutationResponseActorBot");
    return MessageReactionMutationResponseActorBot(
      kind: _expectStringConst(_requiredKey(json, "kind", "MessageReactionMutationResponseActorBot"), "bot", "MessageReactionMutationResponseActorBot.kind"),
      installationId: _asString(_requiredKey(json, "installationId", "MessageReactionMutationResponseActorBot"), "MessageReactionMutationResponseActorBot.installationId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "installationId": installationId,
    };
    return json;
  }
}

sealed class MessageReactionMutationResponseActor {
  const MessageReactionMutationResponseActor();

  factory MessageReactionMutationResponseActor.fromJson(Map<String, Object?> json) {
    switch (json["kind"]) {
      case "punk":
        return MessageReactionMutationResponseActorPunk.fromJson(json);
      case "bot":
        return MessageReactionMutationResponseActorBot.fromJson(json);
      default:
        throw FormatException('MessageReactionMutationResponseActor.kind has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class MessageReactionMutationResponseView {
  final String id;
  final String workspaceId;
  final String conversationId;
  final String messageId;
  final MessageReactionMutationResponseActor actor;
  final String reaction;
  final String reactedAt;

  const MessageReactionMutationResponseView({
    required this.id,
    required this.workspaceId,
    required this.conversationId,
    required this.messageId,
    required this.actor,
    required this.reaction,
    required this.reactedAt,
  });

  factory MessageReactionMutationResponseView.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"id", "workspaceId", "conversationId", "messageId", "actor", "reaction", "reactedAt"}, "MessageReactionMutationResponseView");
    return MessageReactionMutationResponseView(
      id: _asString(_requiredKey(json, "id", "MessageReactionMutationResponseView"), "MessageReactionMutationResponseView.id"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "MessageReactionMutationResponseView"), "MessageReactionMutationResponseView.workspaceId"),
      conversationId: _asString(_requiredKey(json, "conversationId", "MessageReactionMutationResponseView"), "MessageReactionMutationResponseView.conversationId"),
      messageId: _asString(_requiredKey(json, "messageId", "MessageReactionMutationResponseView"), "MessageReactionMutationResponseView.messageId"),
      actor: MessageReactionMutationResponseActor.fromJson(_asMap(_requiredKey(json, "actor", "MessageReactionMutationResponseView"), "MessageReactionMutationResponseView.actor")),
      reaction: _asString(_requiredKey(json, "reaction", "MessageReactionMutationResponseView"), "MessageReactionMutationResponseView.reaction"),
      reactedAt: _asString(_requiredKey(json, "reactedAt", "MessageReactionMutationResponseView"), "MessageReactionMutationResponseView.reactedAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "id": id,
      "workspaceId": workspaceId,
      "conversationId": conversationId,
      "messageId": messageId,
      "actor": actor.toJson(),
      "reaction": reaction,
      "reactedAt": reactedAt,
    };
    return json;
  }
}

enum MessageReactionMutationResponseEffect {
  added("added"),
  removed("removed"),
  unchanged("unchanged"),
  ;

  const MessageReactionMutationResponseEffect(this.value);

  final String value;

  factory MessageReactionMutationResponseEffect.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a MessageReactionMutationResponseEffect value');
  }

  String toJson() => value;
}

class MessageReactionMutationResponse {
  final MessageReactionMutationResponseView? reaction;
  final MessageReactionMutationResponseEffect effect;
  final bool replayed;

  const MessageReactionMutationResponse({
    required this.reaction,
    required this.effect,
    required this.replayed,
  });

  factory MessageReactionMutationResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"reaction", "effect", "replayed"}, "MessageReactionMutationResponse");
    return MessageReactionMutationResponse(
      reaction: _requiredKey(json, "reaction", "MessageReactionMutationResponse") == null ? null : MessageReactionMutationResponseView.fromJson(_asMap(_requiredKey(json, "reaction", "MessageReactionMutationResponse"), "MessageReactionMutationResponse.reaction")),
      effect: MessageReactionMutationResponseEffect.fromJson(_requiredKey(json, "effect", "MessageReactionMutationResponse"), "MessageReactionMutationResponse.effect"),
      replayed: _asBool(_requiredKey(json, "replayed", "MessageReactionMutationResponse"), "MessageReactionMutationResponse.replayed"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "reaction": reaction == null ? null : reaction!.toJson(),
      "effect": effect.toJson(),
      "replayed": replayed,
    };
    return json;
  }
}

class RemoveMessageReactionCommandActorPunk extends RemoveMessageReactionCommandActor {
  final String kind;
  final String punkId;

  const RemoveMessageReactionCommandActorPunk({
    required this.kind,
    required this.punkId,
  }) : super();

  factory RemoveMessageReactionCommandActorPunk.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "RemoveMessageReactionCommandActorPunk");
    return RemoveMessageReactionCommandActorPunk(
      kind: _expectStringConst(_requiredKey(json, "kind", "RemoveMessageReactionCommandActorPunk"), "punk", "RemoveMessageReactionCommandActorPunk.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "RemoveMessageReactionCommandActorPunk"), "RemoveMessageReactionCommandActorPunk.punkId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

class RemoveMessageReactionCommandActorBot extends RemoveMessageReactionCommandActor {
  final String kind;
  final String installationId;

  const RemoveMessageReactionCommandActorBot({
    required this.kind,
    required this.installationId,
  }) : super();

  factory RemoveMessageReactionCommandActorBot.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "installationId"}, "RemoveMessageReactionCommandActorBot");
    return RemoveMessageReactionCommandActorBot(
      kind: _expectStringConst(_requiredKey(json, "kind", "RemoveMessageReactionCommandActorBot"), "bot", "RemoveMessageReactionCommandActorBot.kind"),
      installationId: _asString(_requiredKey(json, "installationId", "RemoveMessageReactionCommandActorBot"), "RemoveMessageReactionCommandActorBot.installationId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "installationId": installationId,
    };
    return json;
  }
}

sealed class RemoveMessageReactionCommandActor {
  const RemoveMessageReactionCommandActor();

  factory RemoveMessageReactionCommandActor.fromJson(Map<String, Object?> json) {
    switch (json["kind"]) {
      case "punk":
        return RemoveMessageReactionCommandActorPunk.fromJson(json);
      case "bot":
        return RemoveMessageReactionCommandActorBot.fromJson(json);
      default:
        throw FormatException('RemoveMessageReactionCommandActor.kind has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class RemoveMessageReactionCommandPayload {
  final String reaction;

  const RemoveMessageReactionCommandPayload({
    required this.reaction,
  });

  factory RemoveMessageReactionCommandPayload.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"reaction"}, "RemoveMessageReactionCommandPayload");
    return RemoveMessageReactionCommandPayload(
      reaction: _asString(_requiredKey(json, "reaction", "RemoveMessageReactionCommandPayload"), "RemoveMessageReactionCommandPayload.reaction"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "reaction": reaction,
    };
    return json;
  }
}

class RemoveMessageReactionCommand {
  final String contract;
  final String commandId;
  final String workspaceId;
  final String conversationId;
  final String messageId;
  final RemoveMessageReactionCommandActor actor;
  final RemoveMessageReactionCommandPayload payload;

  const RemoveMessageReactionCommand({
    required this.contract,
    required this.commandId,
    required this.workspaceId,
    required this.conversationId,
    required this.messageId,
    required this.actor,
    required this.payload,
  });

  factory RemoveMessageReactionCommand.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "commandId", "workspaceId", "conversationId", "messageId", "actor", "payload"}, "RemoveMessageReactionCommand");
    return RemoveMessageReactionCommand(
      contract: _expectStringConst(_requiredKey(json, "contract", "RemoveMessageReactionCommand"), "message.reaction-remove@1", "RemoveMessageReactionCommand.contract"),
      commandId: _asString(_requiredKey(json, "commandId", "RemoveMessageReactionCommand"), "RemoveMessageReactionCommand.commandId"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "RemoveMessageReactionCommand"), "RemoveMessageReactionCommand.workspaceId"),
      conversationId: _asString(_requiredKey(json, "conversationId", "RemoveMessageReactionCommand"), "RemoveMessageReactionCommand.conversationId"),
      messageId: _asString(_requiredKey(json, "messageId", "RemoveMessageReactionCommand"), "RemoveMessageReactionCommand.messageId"),
      actor: RemoveMessageReactionCommandActor.fromJson(_asMap(_requiredKey(json, "actor", "RemoveMessageReactionCommand"), "RemoveMessageReactionCommand.actor")),
      payload: RemoveMessageReactionCommandPayload.fromJson(_asMap(_requiredKey(json, "payload", "RemoveMessageReactionCommand"), "RemoveMessageReactionCommand.payload")),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "commandId": commandId,
      "workspaceId": workspaceId,
      "conversationId": conversationId,
      "messageId": messageId,
      "actor": actor.toJson(),
      "payload": payload.toJson(),
    };
    return json;
  }
}

enum ConversationType {
  stream("stream"),
  forum("forum"),
  dm("dm"),
  workflow("workflow"),
  ;

  const ConversationType(this.value);

  final String value;

  factory ConversationType.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a ConversationType value');
  }

  String toJson() => value;
}

enum ConversationVisibility {
  open("open"),
  private("private"),
  ;

  const ConversationVisibility(this.value);

  final String value;

  factory ConversationVisibility.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a ConversationVisibility value');
  }

  String toJson() => value;
}

enum ConversationMembersItemAccess {
  owner("owner"),
  manager("manager"),
  member("member"),
  guest("guest"),
  ;

  const ConversationMembersItemAccess(this.value);

  final String value;

  factory ConversationMembersItemAccess.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a ConversationMembersItemAccess value');
  }

  String toJson() => value;
}

class ConversationMembersItem {
  final String punkId;
  final ConversationMembersItemAccess access;
  final String joinedAt;
  final String? invitedByPunkId;

  const ConversationMembersItem({
    required this.punkId,
    required this.access,
    required this.joinedAt,
    required this.invitedByPunkId,
  });

  factory ConversationMembersItem.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"punkId", "access", "joinedAt", "invitedByPunkId"}, "ConversationMembersItem");
    return ConversationMembersItem(
      punkId: _asString(_requiredKey(json, "punkId", "ConversationMembersItem"), "ConversationMembersItem.punkId"),
      access: ConversationMembersItemAccess.fromJson(_requiredKey(json, "access", "ConversationMembersItem"), "ConversationMembersItem.access"),
      joinedAt: _asString(_requiredKey(json, "joinedAt", "ConversationMembersItem"), "ConversationMembersItem.joinedAt"),
      invitedByPunkId: _requiredKey(json, "invitedByPunkId", "ConversationMembersItem") == null ? null : _asString(_requiredKey(json, "invitedByPunkId", "ConversationMembersItem"), "ConversationMembersItem.invitedByPunkId"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "punkId": punkId,
      "access": access.toJson(),
      "joinedAt": joinedAt,
      "invitedByPunkId": invitedByPunkId == null ? null : invitedByPunkId!,
    };
    return json;
  }
}

enum ConversationStatus {
  active("active"),
  archived("archived"),
  deleting("deleting"),
  deleted("deleted"),
  ;

  const ConversationStatus(this.value);

  final String value;

  factory ConversationStatus.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a ConversationStatus value');
  }

  String toJson() => value;
}

class Conversation {
  final String id;
  final String workspaceId;
  final String name;
  final ConversationType type;
  final ConversationVisibility visibility;
  final String? description;
  final String? topic;
  final String? purpose;
  final bool topicRequired;
  final int? maxMembers;
  final int? ttlSeconds;
  final String? ttlDeadline;
  final String ownerPunkId;
  final List<ConversationMembersItem> members;
  final ConversationStatus status;
  final int revision;
  final int cursor;
  final String createdAt;
  final String updatedAt;
  final String? archivedAt;

  const Conversation({
    required this.id,
    required this.workspaceId,
    required this.name,
    required this.type,
    required this.visibility,
    required this.description,
    required this.topic,
    required this.purpose,
    required this.topicRequired,
    required this.maxMembers,
    required this.ttlSeconds,
    required this.ttlDeadline,
    required this.ownerPunkId,
    required this.members,
    required this.status,
    required this.revision,
    required this.cursor,
    required this.createdAt,
    required this.updatedAt,
    required this.archivedAt,
  });

  factory Conversation.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"id", "workspaceId", "name", "type", "visibility", "description", "topic", "purpose", "topicRequired", "maxMembers", "ttlSeconds", "ttlDeadline", "ownerPunkId", "members", "status", "revision", "cursor", "createdAt", "updatedAt", "archivedAt"}, "Conversation");
    return Conversation(
      id: _asString(_requiredKey(json, "id", "Conversation"), "Conversation.id"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "Conversation"), "Conversation.workspaceId"),
      name: _asString(_requiredKey(json, "name", "Conversation"), "Conversation.name"),
      type: ConversationType.fromJson(_requiredKey(json, "type", "Conversation"), "Conversation.type"),
      visibility: ConversationVisibility.fromJson(_requiredKey(json, "visibility", "Conversation"), "Conversation.visibility"),
      description: _requiredKey(json, "description", "Conversation") == null ? null : _asString(_requiredKey(json, "description", "Conversation"), "Conversation.description"),
      topic: _requiredKey(json, "topic", "Conversation") == null ? null : _asString(_requiredKey(json, "topic", "Conversation"), "Conversation.topic"),
      purpose: _requiredKey(json, "purpose", "Conversation") == null ? null : _asString(_requiredKey(json, "purpose", "Conversation"), "Conversation.purpose"),
      topicRequired: _asBool(_requiredKey(json, "topicRequired", "Conversation"), "Conversation.topicRequired"),
      maxMembers: _requiredKey(json, "maxMembers", "Conversation") == null ? null : _asInt(_requiredKey(json, "maxMembers", "Conversation"), "Conversation.maxMembers"),
      ttlSeconds: _requiredKey(json, "ttlSeconds", "Conversation") == null ? null : _asInt(_requiredKey(json, "ttlSeconds", "Conversation"), "Conversation.ttlSeconds"),
      ttlDeadline: _requiredKey(json, "ttlDeadline", "Conversation") == null ? null : _asString(_requiredKey(json, "ttlDeadline", "Conversation"), "Conversation.ttlDeadline"),
      ownerPunkId: _asString(_requiredKey(json, "ownerPunkId", "Conversation"), "Conversation.ownerPunkId"),
      members: _asList(_requiredKey(json, "members", "Conversation"), "Conversation.members").map((item) => ConversationMembersItem.fromJson(_asMap(item, "Conversation.members[]"))).toList(growable: false),
      status: ConversationStatus.fromJson(_requiredKey(json, "status", "Conversation"), "Conversation.status"),
      revision: _asInt(_requiredKey(json, "revision", "Conversation"), "Conversation.revision"),
      cursor: _asInt(_requiredKey(json, "cursor", "Conversation"), "Conversation.cursor"),
      createdAt: _asString(_requiredKey(json, "createdAt", "Conversation"), "Conversation.createdAt"),
      updatedAt: _asString(_requiredKey(json, "updatedAt", "Conversation"), "Conversation.updatedAt"),
      archivedAt: _requiredKey(json, "archivedAt", "Conversation") == null ? null : _asString(_requiredKey(json, "archivedAt", "Conversation"), "Conversation.archivedAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "id": id,
      "workspaceId": workspaceId,
      "name": name,
      "type": type.toJson(),
      "visibility": visibility.toJson(),
      "description": description == null ? null : description!,
      "topic": topic == null ? null : topic!,
      "purpose": purpose == null ? null : purpose!,
      "topicRequired": topicRequired,
      "maxMembers": maxMembers == null ? null : maxMembers!,
      "ttlSeconds": ttlSeconds == null ? null : ttlSeconds!,
      "ttlDeadline": ttlDeadline == null ? null : ttlDeadline!,
      "ownerPunkId": ownerPunkId,
      "members": members.map((item) => item.toJson()).toList(growable: false),
      "status": status.toJson(),
      "revision": revision,
      "cursor": cursor,
      "createdAt": createdAt,
      "updatedAt": updatedAt,
      "archivedAt": archivedAt == null ? null : archivedAt!,
    };
    return json;
  }
}

enum PunksProblemCode {
  invalidInput("invalid_input"),
  payloadTooLarge("payload_too_large"),
  unauthenticated("unauthenticated"),
  accountMerged("account_merged"),
  forbidden("forbidden"),
  notFound("not_found"),
  slugClaimed("slug_claimed"),
  idempotencyConflict("idempotency_conflict"),
  identityConflict("identity_conflict"),
  revisionConflict("revision_conflict"),
  invalidTransition("invalid_transition"),
  inviteInvalid("invite_invalid"),
  inviteExpired("invite_expired"),
  inviteExhausted("invite_exhausted"),
  inviteRevoked("invite_revoked"),
  inviteRoleForbidden("invite_role_forbidden"),
  queryTooShort("query_too_short"),
  commandInProgress("command_in_progress"),
  storageUnavailable("storage_unavailable"),
  uploadHashInvalid("upload_hash_invalid"),
  uploadConflict("upload_conflict"),
  uploadAmbiguous("upload_ambiguous"),
  uploadExpired("upload_expired"),
  attestationFailed("attestation_failed"),
  temporarilyUnavailable("temporarily_unavailable"),
  internal("internal"),
  ;

  const PunksProblemCode(this.value);

  final String value;

  factory PunksProblemCode.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a PunksProblemCode value');
  }

  String toJson() => value;
}

enum PunksProblemRetry {
  never("never"),
  sameCommand("same_command"),
  later("later"),
  ;

  const PunksProblemRetry(this.value);

  final String value;

  factory PunksProblemRetry.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a PunksProblemRetry value');
  }

  String toJson() => value;
}

class PunksProblem {
  final String type;
  final String title;
  final int status;
  final PunksProblemCode code;
  final String? detail;
  final String correlationId;
  final PunksProblemRetry retry;
  final int? retryAfterMs;

  const PunksProblem({
    required this.type,
    required this.title,
    required this.status,
    required this.code,
    this.detail,
    required this.correlationId,
    required this.retry,
    this.retryAfterMs,
  });

  factory PunksProblem.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"type", "title", "status", "code", "detail", "correlationId", "retry", "retryAfterMs"}, "PunksProblem");
    return PunksProblem(
      type: _asString(_requiredKey(json, "type", "PunksProblem"), "PunksProblem.type"),
      title: _asString(_requiredKey(json, "title", "PunksProblem"), "PunksProblem.title"),
      status: _asInt(_requiredKey(json, "status", "PunksProblem"), "PunksProblem.status"),
      code: PunksProblemCode.fromJson(_requiredKey(json, "code", "PunksProblem"), "PunksProblem.code"),
      detail: json.containsKey("detail") ? _asString(json["detail"], "PunksProblem.detail") : null,
      correlationId: _asString(_requiredKey(json, "correlationId", "PunksProblem"), "PunksProblem.correlationId"),
      retry: PunksProblemRetry.fromJson(_requiredKey(json, "retry", "PunksProblem"), "PunksProblem.retry"),
      retryAfterMs: json.containsKey("retryAfterMs") ? _asInt(json["retryAfterMs"], "PunksProblem.retryAfterMs") : null,
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "type": type,
      "title": title,
      "status": status,
      "code": code.toJson(),
      "correlationId": correlationId,
      "retry": retry.toJson(),
    };
    if (detail != null) {
      json["detail"] = detail!;
    }
    if (retryAfterMs != null) {
      json["retryAfterMs"] = retryAfterMs!;
    }
    return json;
  }
}

class CreateMediaUploadGrantCommandActor {
  final String kind;
  final String punkId;

  const CreateMediaUploadGrantCommandActor({
    required this.kind,
    required this.punkId,
  });

  factory CreateMediaUploadGrantCommandActor.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "CreateMediaUploadGrantCommandActor");
    return CreateMediaUploadGrantCommandActor(
      kind: _expectStringConst(_requiredKey(json, "kind", "CreateMediaUploadGrantCommandActor"), "punk", "CreateMediaUploadGrantCommandActor.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "CreateMediaUploadGrantCommandActor"), "CreateMediaUploadGrantCommandActor.punkId"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

enum CreateMediaUploadGrantCommandPayloadContentType {
  applicationJson("application/json"),
  applicationPdf("application/pdf"),
  applicationZip("application/zip"),
  audioMpeg("audio/mpeg"),
  audioOgg("audio/ogg"),
  audioWav("audio/wav"),
  audioWebm("audio/webm"),
  imageAvif("image/avif"),
  imageGif("image/gif"),
  imageJpeg("image/jpeg"),
  imagePng("image/png"),
  imageWebp("image/webp"),
  textCsv("text/csv"),
  textMarkdown("text/markdown"),
  textPlain("text/plain"),
  videoMp4("video/mp4"),
  videoQuicktime("video/quicktime"),
  videoWebm("video/webm"),
  ;

  const CreateMediaUploadGrantCommandPayloadContentType(this.value);

  final String value;

  factory CreateMediaUploadGrantCommandPayloadContentType.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a CreateMediaUploadGrantCommandPayloadContentType value');
  }

  String toJson() => value;
}

class CreateMediaUploadGrantCommandPayload {
  final String purpose;
  final int byteLength;
  final CreateMediaUploadGrantCommandPayloadContentType contentType;
  final String sha256;

  const CreateMediaUploadGrantCommandPayload({
    required this.purpose,
    required this.byteLength,
    required this.contentType,
    required this.sha256,
  });

  factory CreateMediaUploadGrantCommandPayload.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"purpose", "byteLength", "contentType", "sha256"}, "CreateMediaUploadGrantCommandPayload");
    return CreateMediaUploadGrantCommandPayload(
      purpose: _expectStringConst(_requiredKey(json, "purpose", "CreateMediaUploadGrantCommandPayload"), "message_attachment", "CreateMediaUploadGrantCommandPayload.purpose"),
      byteLength: _asInt(_requiredKey(json, "byteLength", "CreateMediaUploadGrantCommandPayload"), "CreateMediaUploadGrantCommandPayload.byteLength"),
      contentType: CreateMediaUploadGrantCommandPayloadContentType.fromJson(_requiredKey(json, "contentType", "CreateMediaUploadGrantCommandPayload"), "CreateMediaUploadGrantCommandPayload.contentType"),
      sha256: _asString(_requiredKey(json, "sha256", "CreateMediaUploadGrantCommandPayload"), "CreateMediaUploadGrantCommandPayload.sha256"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "purpose": purpose,
      "byteLength": byteLength,
      "contentType": contentType.toJson(),
      "sha256": sha256,
    };
    return json;
  }
}

class CreateMediaUploadGrantCommand {
  final String contract;
  final String commandId;
  final String workspaceId;
  final CreateMediaUploadGrantCommandActor actor;
  final CreateMediaUploadGrantCommandPayload payload;

  const CreateMediaUploadGrantCommand({
    required this.contract,
    required this.commandId,
    required this.workspaceId,
    required this.actor,
    required this.payload,
  });

  factory CreateMediaUploadGrantCommand.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "commandId", "workspaceId", "actor", "payload"}, "CreateMediaUploadGrantCommand");
    return CreateMediaUploadGrantCommand(
      contract: _expectStringConst(_requiredKey(json, "contract", "CreateMediaUploadGrantCommand"), "media-upload.grant-create@1", "CreateMediaUploadGrantCommand.contract"),
      commandId: _asString(_requiredKey(json, "commandId", "CreateMediaUploadGrantCommand"), "CreateMediaUploadGrantCommand.commandId"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "CreateMediaUploadGrantCommand"), "CreateMediaUploadGrantCommand.workspaceId"),
      actor: CreateMediaUploadGrantCommandActor.fromJson(_asMap(_requiredKey(json, "actor", "CreateMediaUploadGrantCommand"), "CreateMediaUploadGrantCommand.actor")),
      payload: CreateMediaUploadGrantCommandPayload.fromJson(_asMap(_requiredKey(json, "payload", "CreateMediaUploadGrantCommand"), "CreateMediaUploadGrantCommand.payload")),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "commandId": commandId,
      "workspaceId": workspaceId,
      "actor": actor.toJson(),
      "payload": payload.toJson(),
    };
    return json;
  }
}

enum MediaUploadStatusState {
  uploading("uploading"),
  finalizing("finalizing"),
  candidate("candidate"),
  cleanupPending("cleanup_pending"),
  abandoned("abandoned"),
  expired("expired"),
  rejected("rejected"),
  ;

  const MediaUploadStatusState(this.value);

  final String value;

  factory MediaUploadStatusState.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a MediaUploadStatusState value');
  }

  String toJson() => value;
}

class MediaUploadStatusUploadedPartsItem {
  final int partNumber;
  final int byteLength;
  final String sha256;

  const MediaUploadStatusUploadedPartsItem({
    required this.partNumber,
    required this.byteLength,
    required this.sha256,
  });

  factory MediaUploadStatusUploadedPartsItem.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"partNumber", "byteLength", "sha256"}, "MediaUploadStatusUploadedPartsItem");
    return MediaUploadStatusUploadedPartsItem(
      partNumber: _asInt(_requiredKey(json, "partNumber", "MediaUploadStatusUploadedPartsItem"), "MediaUploadStatusUploadedPartsItem.partNumber"),
      byteLength: _asInt(_requiredKey(json, "byteLength", "MediaUploadStatusUploadedPartsItem"), "MediaUploadStatusUploadedPartsItem.byteLength"),
      sha256: _asString(_requiredKey(json, "sha256", "MediaUploadStatusUploadedPartsItem"), "MediaUploadStatusUploadedPartsItem.sha256"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "partNumber": partNumber,
      "byteLength": byteLength,
      "sha256": sha256,
    };
    return json;
  }
}

class MediaUploadStatusCandidate {
  final String mediaId;
  final int byteLength;
  final String contentType;
  final String sha256;
  final String finalizedAt;

  const MediaUploadStatusCandidate({
    required this.mediaId,
    required this.byteLength,
    required this.contentType,
    required this.sha256,
    required this.finalizedAt,
  });

  factory MediaUploadStatusCandidate.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"mediaId", "byteLength", "contentType", "sha256", "finalizedAt"}, "MediaUploadStatusCandidate");
    return MediaUploadStatusCandidate(
      mediaId: _asString(_requiredKey(json, "mediaId", "MediaUploadStatusCandidate"), "MediaUploadStatusCandidate.mediaId"),
      byteLength: _asInt(_requiredKey(json, "byteLength", "MediaUploadStatusCandidate"), "MediaUploadStatusCandidate.byteLength"),
      contentType: _asString(_requiredKey(json, "contentType", "MediaUploadStatusCandidate"), "MediaUploadStatusCandidate.contentType"),
      sha256: _asString(_requiredKey(json, "sha256", "MediaUploadStatusCandidate"), "MediaUploadStatusCandidate.sha256"),
      finalizedAt: _asString(_requiredKey(json, "finalizedAt", "MediaUploadStatusCandidate"), "MediaUploadStatusCandidate.finalizedAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "mediaId": mediaId,
      "byteLength": byteLength,
      "contentType": contentType,
      "sha256": sha256,
      "finalizedAt": finalizedAt,
    };
    return json;
  }
}

enum MediaUploadStatusFailureCode {
  storageUnavailable("storage_unavailable"),
  hashInvalid("hash_invalid"),
  conflict("conflict"),
  ambiguous("ambiguous"),
  expired("expired"),
  abandoned("abandoned"),
  authorizationLost("authorization_lost"),
  ;

  const MediaUploadStatusFailureCode(this.value);

  final String value;

  factory MediaUploadStatusFailureCode.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a MediaUploadStatusFailureCode value');
  }

  String toJson() => value;
}

enum MediaUploadStatusFailureRetry {
  sameCommand("same_command"),
  later("later"),
  newIntent("new_intent"),
  never("never"),
  ;

  const MediaUploadStatusFailureRetry(this.value);

  final String value;

  factory MediaUploadStatusFailureRetry.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a MediaUploadStatusFailureRetry value');
  }

  String toJson() => value;
}

class MediaUploadStatusFailure {
  final MediaUploadStatusFailureCode code;
  final MediaUploadStatusFailureRetry retry;

  const MediaUploadStatusFailure({
    required this.code,
    required this.retry,
  });

  factory MediaUploadStatusFailure.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"code", "retry"}, "MediaUploadStatusFailure");
    return MediaUploadStatusFailure(
      code: MediaUploadStatusFailureCode.fromJson(_requiredKey(json, "code", "MediaUploadStatusFailure"), "MediaUploadStatusFailure.code"),
      retry: MediaUploadStatusFailureRetry.fromJson(_requiredKey(json, "retry", "MediaUploadStatusFailure"), "MediaUploadStatusFailure.retry"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "code": code.toJson(),
      "retry": retry.toJson(),
    };
    return json;
  }
}

class MediaUploadStatus {
  final String contract;
  final String uploadId;
  final String workspaceId;
  final String punkId;
  final String purpose;
  final int byteLength;
  final String contentType;
  final String sha256;
  final String issuedAt;
  final String expiresAt;
  final int partSize;
  final int partCount;
  final MediaUploadStatusState state;
  final List<MediaUploadStatusUploadedPartsItem> uploadedParts;
  final MediaUploadStatusCandidate? candidate;
  final MediaUploadStatusFailure? failure;

  const MediaUploadStatus({
    required this.contract,
    required this.uploadId,
    required this.workspaceId,
    required this.punkId,
    required this.purpose,
    required this.byteLength,
    required this.contentType,
    required this.sha256,
    required this.issuedAt,
    required this.expiresAt,
    required this.partSize,
    required this.partCount,
    required this.state,
    required this.uploadedParts,
    required this.candidate,
    required this.failure,
  });

  factory MediaUploadStatus.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "uploadId", "workspaceId", "punkId", "purpose", "byteLength", "contentType", "sha256", "issuedAt", "expiresAt", "partSize", "partCount", "state", "uploadedParts", "candidate", "failure"}, "MediaUploadStatus");
    if (!((((_hasKey(json, "state") && (!_hasKey(json, "state") || (_valueAt(json, "state") == "candidate"))) ? ((!_hasKey(json, "candidate") || ((_valueAt(json, "candidate") is Map<String, Object?>) && _hasKey(_valueAt(json, "candidate"), "mediaId") && _hasKey(_valueAt(json, "candidate"), "byteLength") && _hasKey(_valueAt(json, "candidate"), "contentType") && _hasKey(_valueAt(json, "candidate"), "sha256") && _hasKey(_valueAt(json, "candidate"), "finalizedAt") && (!_hasKey(_valueAt(json, "candidate"), "mediaId") || ((_valueAt(_valueAt(json, "candidate"), "mediaId") is String))) && (!_hasKey(_valueAt(json, "candidate"), "byteLength") || ((_valueAt(_valueAt(json, "candidate"), "byteLength") is int))) && (!_hasKey(_valueAt(json, "candidate"), "contentType") || ((_valueAt(_valueAt(json, "candidate"), "contentType") is String))) && (!_hasKey(_valueAt(json, "candidate"), "sha256") || ((_valueAt(_valueAt(json, "candidate"), "sha256") is String))) && (!_hasKey(_valueAt(json, "candidate"), "finalizedAt") || ((_valueAt(_valueAt(json, "candidate"), "finalizedAt") is String))))) && (!_hasKey(json, "failure") || ((_valueAt(json, "failure") == null)))) : ((!_hasKey(json, "candidate") || ((_valueAt(json, "candidate") == null)))))) && (((_hasKey(json, "state") && (!_hasKey(json, "state") || (_valueAt(json, "state") == "rejected"))) ? ((!_hasKey(json, "failure") || ((_valueAt(json, "failure") is Map<String, Object?>) && _hasKey(_valueAt(json, "failure"), "code") && _hasKey(_valueAt(json, "failure"), "retry") && (!_hasKey(_valueAt(json, "failure"), "code") || (const <Object?>["storage_unavailable", "hash_invalid", "conflict", "ambiguous", "expired", "abandoned", "authorization_lost"].contains(_valueAt(_valueAt(json, "failure"), "code")))) && (!_hasKey(_valueAt(json, "failure"), "retry") || (const <Object?>["same_command", "later", "new_intent", "never"].contains(_valueAt(_valueAt(json, "failure"), "retry"))))))) : (true))))) {
      throw FormatException("MediaUploadStatus violates its structural alternatives");
    }
    return MediaUploadStatus(
      contract: _expectStringConst(_requiredKey(json, "contract", "MediaUploadStatus"), "media-upload.status@1", "MediaUploadStatus.contract"),
      uploadId: _asString(_requiredKey(json, "uploadId", "MediaUploadStatus"), "MediaUploadStatus.uploadId"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "MediaUploadStatus"), "MediaUploadStatus.workspaceId"),
      punkId: _asString(_requiredKey(json, "punkId", "MediaUploadStatus"), "MediaUploadStatus.punkId"),
      purpose: _expectStringConst(_requiredKey(json, "purpose", "MediaUploadStatus"), "message_attachment", "MediaUploadStatus.purpose"),
      byteLength: _asInt(_requiredKey(json, "byteLength", "MediaUploadStatus"), "MediaUploadStatus.byteLength"),
      contentType: _asString(_requiredKey(json, "contentType", "MediaUploadStatus"), "MediaUploadStatus.contentType"),
      sha256: _asString(_requiredKey(json, "sha256", "MediaUploadStatus"), "MediaUploadStatus.sha256"),
      issuedAt: _asString(_requiredKey(json, "issuedAt", "MediaUploadStatus"), "MediaUploadStatus.issuedAt"),
      expiresAt: _asString(_requiredKey(json, "expiresAt", "MediaUploadStatus"), "MediaUploadStatus.expiresAt"),
      partSize: _expectIntConst(_requiredKey(json, "partSize", "MediaUploadStatus"), 8388608, "MediaUploadStatus.partSize"),
      partCount: _asInt(_requiredKey(json, "partCount", "MediaUploadStatus"), "MediaUploadStatus.partCount"),
      state: MediaUploadStatusState.fromJson(_requiredKey(json, "state", "MediaUploadStatus"), "MediaUploadStatus.state"),
      uploadedParts: _asList(_requiredKey(json, "uploadedParts", "MediaUploadStatus"), "MediaUploadStatus.uploadedParts").map((item) => MediaUploadStatusUploadedPartsItem.fromJson(_asMap(item, "MediaUploadStatus.uploadedParts[]"))).toList(growable: false),
      candidate: _requiredKey(json, "candidate", "MediaUploadStatus") == null ? null : MediaUploadStatusCandidate.fromJson(_asMap(_requiredKey(json, "candidate", "MediaUploadStatus"), "MediaUploadStatus.candidate")),
      failure: _requiredKey(json, "failure", "MediaUploadStatus") == null ? null : MediaUploadStatusFailure.fromJson(_asMap(_requiredKey(json, "failure", "MediaUploadStatus"), "MediaUploadStatus.failure")),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "uploadId": uploadId,
      "workspaceId": workspaceId,
      "punkId": punkId,
      "purpose": purpose,
      "byteLength": byteLength,
      "contentType": contentType,
      "sha256": sha256,
      "issuedAt": issuedAt,
      "expiresAt": expiresAt,
      "partSize": partSize,
      "partCount": partCount,
      "state": state.toJson(),
      "uploadedParts": uploadedParts.map((item) => item.toJson()).toList(growable: false),
      "candidate": candidate == null ? null : candidate!.toJson(),
      "failure": failure == null ? null : failure!.toJson(),
    };
    return json;
  }
}

class MediaUploadGrantCredential {
  final String scheme;
  final String token;

  const MediaUploadGrantCredential({
    required this.scheme,
    required this.token,
  });

  factory MediaUploadGrantCredential.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"scheme", "token"}, "MediaUploadGrantCredential");
    return MediaUploadGrantCredential(
      scheme: _expectStringConst(_requiredKey(json, "scheme", "MediaUploadGrantCredential"), "PunksUpload", "MediaUploadGrantCredential.scheme"),
      token: _asString(_requiredKey(json, "token", "MediaUploadGrantCredential"), "MediaUploadGrantCredential.token"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "scheme": scheme,
      "token": token,
    };
    return json;
  }
}

class MediaUploadGrantEndpoints {
  final String partUrlTemplate;
  final String finalizeUrl;
  final String statusUrl;
  final String abandonUrl;

  const MediaUploadGrantEndpoints({
    required this.partUrlTemplate,
    required this.finalizeUrl,
    required this.statusUrl,
    required this.abandonUrl,
  });

  factory MediaUploadGrantEndpoints.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"partUrlTemplate", "finalizeUrl", "statusUrl", "abandonUrl"}, "MediaUploadGrantEndpoints");
    return MediaUploadGrantEndpoints(
      partUrlTemplate: _asString(_requiredKey(json, "partUrlTemplate", "MediaUploadGrantEndpoints"), "MediaUploadGrantEndpoints.partUrlTemplate"),
      finalizeUrl: _asString(_requiredKey(json, "finalizeUrl", "MediaUploadGrantEndpoints"), "MediaUploadGrantEndpoints.finalizeUrl"),
      statusUrl: _asString(_requiredKey(json, "statusUrl", "MediaUploadGrantEndpoints"), "MediaUploadGrantEndpoints.statusUrl"),
      abandonUrl: _asString(_requiredKey(json, "abandonUrl", "MediaUploadGrantEndpoints"), "MediaUploadGrantEndpoints.abandonUrl"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "partUrlTemplate": partUrlTemplate,
      "finalizeUrl": finalizeUrl,
      "statusUrl": statusUrl,
      "abandonUrl": abandonUrl,
    };
    return json;
  }
}

class MediaUploadGrant {
  final String contract;
  final MediaUploadStatus status;
  final MediaUploadGrantCredential credential;
  final MediaUploadGrantEndpoints endpoints;
  final bool replayed;

  const MediaUploadGrant({
    required this.contract,
    required this.status,
    required this.credential,
    required this.endpoints,
    required this.replayed,
  });

  factory MediaUploadGrant.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "status", "credential", "endpoints", "replayed"}, "MediaUploadGrant");
    return MediaUploadGrant(
      contract: _expectStringConst(_requiredKey(json, "contract", "MediaUploadGrant"), "media-upload.grant@1", "MediaUploadGrant.contract"),
      status: MediaUploadStatus.fromJson(_asMap(_requiredKey(json, "status", "MediaUploadGrant"), "MediaUploadGrant.status")),
      credential: MediaUploadGrantCredential.fromJson(_asMap(_requiredKey(json, "credential", "MediaUploadGrant"), "MediaUploadGrant.credential")),
      endpoints: MediaUploadGrantEndpoints.fromJson(_asMap(_requiredKey(json, "endpoints", "MediaUploadGrant"), "MediaUploadGrant.endpoints")),
      replayed: _asBool(_requiredKey(json, "replayed", "MediaUploadGrant"), "MediaUploadGrant.replayed"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "status": status.toJson(),
      "credential": credential.toJson(),
      "endpoints": endpoints.toJson(),
      "replayed": replayed,
    };
    return json;
  }
}

class MediaUploadPart {
  final String contract;
  final String uploadId;
  final int partNumber;
  final int byteLength;
  final String sha256;
  final bool replayed;

  const MediaUploadPart({
    required this.contract,
    required this.uploadId,
    required this.partNumber,
    required this.byteLength,
    required this.sha256,
    required this.replayed,
  });

  factory MediaUploadPart.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "uploadId", "partNumber", "byteLength", "sha256", "replayed"}, "MediaUploadPart");
    return MediaUploadPart(
      contract: _expectStringConst(_requiredKey(json, "contract", "MediaUploadPart"), "media-upload.part@1", "MediaUploadPart.contract"),
      uploadId: _asString(_requiredKey(json, "uploadId", "MediaUploadPart"), "MediaUploadPart.uploadId"),
      partNumber: _asInt(_requiredKey(json, "partNumber", "MediaUploadPart"), "MediaUploadPart.partNumber"),
      byteLength: _asInt(_requiredKey(json, "byteLength", "MediaUploadPart"), "MediaUploadPart.byteLength"),
      sha256: _asString(_requiredKey(json, "sha256", "MediaUploadPart"), "MediaUploadPart.sha256"),
      replayed: _asBool(_requiredKey(json, "replayed", "MediaUploadPart"), "MediaUploadPart.replayed"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "uploadId": uploadId,
      "partNumber": partNumber,
      "byteLength": byteLength,
      "sha256": sha256,
      "replayed": replayed,
    };
    return json;
  }
}

class FinalizeMediaUploadCommandActor {
  final String kind;
  final String punkId;

  const FinalizeMediaUploadCommandActor({
    required this.kind,
    required this.punkId,
  });

  factory FinalizeMediaUploadCommandActor.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "FinalizeMediaUploadCommandActor");
    return FinalizeMediaUploadCommandActor(
      kind: _expectStringConst(_requiredKey(json, "kind", "FinalizeMediaUploadCommandActor"), "punk", "FinalizeMediaUploadCommandActor.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "FinalizeMediaUploadCommandActor"), "FinalizeMediaUploadCommandActor.punkId"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

class FinalizeMediaUploadCommand {
  final String contract;
  final String commandId;
  final String workspaceId;
  final String uploadId;
  final FinalizeMediaUploadCommandActor actor;

  const FinalizeMediaUploadCommand({
    required this.contract,
    required this.commandId,
    required this.workspaceId,
    required this.uploadId,
    required this.actor,
  });

  factory FinalizeMediaUploadCommand.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "commandId", "workspaceId", "uploadId", "actor"}, "FinalizeMediaUploadCommand");
    return FinalizeMediaUploadCommand(
      contract: _expectStringConst(_requiredKey(json, "contract", "FinalizeMediaUploadCommand"), "media-upload.finalize@1", "FinalizeMediaUploadCommand.contract"),
      commandId: _asString(_requiredKey(json, "commandId", "FinalizeMediaUploadCommand"), "FinalizeMediaUploadCommand.commandId"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "FinalizeMediaUploadCommand"), "FinalizeMediaUploadCommand.workspaceId"),
      uploadId: _asString(_requiredKey(json, "uploadId", "FinalizeMediaUploadCommand"), "FinalizeMediaUploadCommand.uploadId"),
      actor: FinalizeMediaUploadCommandActor.fromJson(_asMap(_requiredKey(json, "actor", "FinalizeMediaUploadCommand"), "FinalizeMediaUploadCommand.actor")),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "commandId": commandId,
      "workspaceId": workspaceId,
      "uploadId": uploadId,
      "actor": actor.toJson(),
    };
    return json;
  }
}

class AbandonMediaUploadCommandActor {
  final String kind;
  final String punkId;

  const AbandonMediaUploadCommandActor({
    required this.kind,
    required this.punkId,
  });

  factory AbandonMediaUploadCommandActor.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "AbandonMediaUploadCommandActor");
    return AbandonMediaUploadCommandActor(
      kind: _expectStringConst(_requiredKey(json, "kind", "AbandonMediaUploadCommandActor"), "punk", "AbandonMediaUploadCommandActor.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "AbandonMediaUploadCommandActor"), "AbandonMediaUploadCommandActor.punkId"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

class AbandonMediaUploadCommand {
  final String contract;
  final String commandId;
  final String workspaceId;
  final String uploadId;
  final AbandonMediaUploadCommandActor actor;

  const AbandonMediaUploadCommand({
    required this.contract,
    required this.commandId,
    required this.workspaceId,
    required this.uploadId,
    required this.actor,
  });

  factory AbandonMediaUploadCommand.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "commandId", "workspaceId", "uploadId", "actor"}, "AbandonMediaUploadCommand");
    return AbandonMediaUploadCommand(
      contract: _expectStringConst(_requiredKey(json, "contract", "AbandonMediaUploadCommand"), "media-upload.abandon@1", "AbandonMediaUploadCommand.contract"),
      commandId: _asString(_requiredKey(json, "commandId", "AbandonMediaUploadCommand"), "AbandonMediaUploadCommand.commandId"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "AbandonMediaUploadCommand"), "AbandonMediaUploadCommand.workspaceId"),
      uploadId: _asString(_requiredKey(json, "uploadId", "AbandonMediaUploadCommand"), "AbandonMediaUploadCommand.uploadId"),
      actor: AbandonMediaUploadCommandActor.fromJson(_asMap(_requiredKey(json, "actor", "AbandonMediaUploadCommand"), "AbandonMediaUploadCommand.actor")),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "commandId": commandId,
      "workspaceId": workspaceId,
      "uploadId": uploadId,
      "actor": actor.toJson(),
    };
    return json;
  }
}

enum PunkStatus {
  active("active"),
  merged("merged"),
  deleting("deleting"),
  deleted("deleted"),
  ;

  const PunkStatus(this.value);

  final String value;

  factory PunkStatus.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a PunkStatus value');
  }

  String toJson() => value;
}

enum PunkIdentitiesItemProvider {
  google("google"),
  github("github"),
  passkey("passkey"),
  ;

  const PunkIdentitiesItemProvider(this.value);

  final String value;

  factory PunkIdentitiesItemProvider.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a PunkIdentitiesItemProvider value');
  }

  String toJson() => value;
}

class PunkIdentitiesItem {
  final PunkIdentitiesItemProvider provider;
  final String subjectHash;
  final String emailHash;
  final String? verifiedEmail;
  final String? username;
  final String? credentialId;
  final String linkedAt;

  const PunkIdentitiesItem({
    required this.provider,
    required this.subjectHash,
    required this.emailHash,
    required this.verifiedEmail,
    required this.username,
    required this.credentialId,
    required this.linkedAt,
  });

  factory PunkIdentitiesItem.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"provider", "subjectHash", "emailHash", "verifiedEmail", "username", "credentialId", "linkedAt"}, "PunkIdentitiesItem");
    return PunkIdentitiesItem(
      provider: PunkIdentitiesItemProvider.fromJson(_requiredKey(json, "provider", "PunkIdentitiesItem"), "PunkIdentitiesItem.provider"),
      subjectHash: _asString(_requiredKey(json, "subjectHash", "PunkIdentitiesItem"), "PunkIdentitiesItem.subjectHash"),
      emailHash: _asString(_requiredKey(json, "emailHash", "PunkIdentitiesItem"), "PunkIdentitiesItem.emailHash"),
      verifiedEmail: _requiredKey(json, "verifiedEmail", "PunkIdentitiesItem") == null ? null : _asString(_requiredKey(json, "verifiedEmail", "PunkIdentitiesItem"), "PunkIdentitiesItem.verifiedEmail"),
      username: _requiredKey(json, "username", "PunkIdentitiesItem") == null ? null : _asString(_requiredKey(json, "username", "PunkIdentitiesItem"), "PunkIdentitiesItem.username"),
      credentialId: _requiredKey(json, "credentialId", "PunkIdentitiesItem") == null ? null : _asString(_requiredKey(json, "credentialId", "PunkIdentitiesItem"), "PunkIdentitiesItem.credentialId"),
      linkedAt: _asString(_requiredKey(json, "linkedAt", "PunkIdentitiesItem"), "PunkIdentitiesItem.linkedAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "provider": provider.toJson(),
      "subjectHash": subjectHash,
      "emailHash": emailHash,
      "verifiedEmail": verifiedEmail == null ? null : verifiedEmail!,
      "username": username == null ? null : username!,
      "credentialId": credentialId == null ? null : credentialId!,
      "linkedAt": linkedAt,
    };
    return json;
  }
}

class Punk {
  final String id;
  final PunkStatus status;
  final String displayName;
  final String? avatarUrl;
  final List<PunkIdentitiesItem> identities;
  final String? mergedInto;
  final int revision;
  final String createdAt;
  final String updatedAt;

  const Punk({
    required this.id,
    required this.status,
    required this.displayName,
    required this.avatarUrl,
    required this.identities,
    required this.mergedInto,
    required this.revision,
    required this.createdAt,
    required this.updatedAt,
  });

  factory Punk.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"id", "status", "displayName", "avatarUrl", "identities", "mergedInto", "revision", "createdAt", "updatedAt"}, "Punk");
    return Punk(
      id: _asString(_requiredKey(json, "id", "Punk"), "Punk.id"),
      status: PunkStatus.fromJson(_requiredKey(json, "status", "Punk"), "Punk.status"),
      displayName: _asString(_requiredKey(json, "displayName", "Punk"), "Punk.displayName"),
      avatarUrl: _requiredKey(json, "avatarUrl", "Punk") == null ? null : _asString(_requiredKey(json, "avatarUrl", "Punk"), "Punk.avatarUrl"),
      identities: _asList(_requiredKey(json, "identities", "Punk"), "Punk.identities").map((item) => PunkIdentitiesItem.fromJson(_asMap(item, "Punk.identities[]"))).toList(growable: false),
      mergedInto: _requiredKey(json, "mergedInto", "Punk") == null ? null : _asString(_requiredKey(json, "mergedInto", "Punk"), "Punk.mergedInto"),
      revision: _asInt(_requiredKey(json, "revision", "Punk"), "Punk.revision"),
      createdAt: _asString(_requiredKey(json, "createdAt", "Punk"), "Punk.createdAt"),
      updatedAt: _asString(_requiredKey(json, "updatedAt", "Punk"), "Punk.updatedAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "id": id,
      "status": status.toJson(),
      "displayName": displayName,
      "avatarUrl": avatarUrl == null ? null : avatarUrl!,
      "identities": identities.map((item) => item.toJson()).toList(growable: false),
      "mergedInto": mergedInto == null ? null : mergedInto!,
      "revision": revision,
      "createdAt": createdAt,
      "updatedAt": updatedAt,
    };
    return json;
  }
}

class GetPunkProfileQuery {
  final String contract;

  const GetPunkProfileQuery({
    required this.contract,
  });

  factory GetPunkProfileQuery.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract"}, "GetPunkProfileQuery");
    return GetPunkProfileQuery(
      contract: _expectStringConst(_requiredKey(json, "contract", "GetPunkProfileQuery"), "punk.get@1", "GetPunkProfileQuery.contract"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
    };
    return json;
  }
}

class UpdatePunkProfileCommand {
  final String contract;
  final String commandId;
  final int expectedRevision;
  final String displayName;
  final String? avatarUrl;

  const UpdatePunkProfileCommand({
    required this.contract,
    required this.commandId,
    required this.expectedRevision,
    required this.displayName,
    required this.avatarUrl,
  });

  factory UpdatePunkProfileCommand.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "commandId", "expectedRevision", "displayName", "avatarUrl"}, "UpdatePunkProfileCommand");
    return UpdatePunkProfileCommand(
      contract: _expectStringConst(_requiredKey(json, "contract", "UpdatePunkProfileCommand"), "punk.update@1", "UpdatePunkProfileCommand.contract"),
      commandId: _asString(_requiredKey(json, "commandId", "UpdatePunkProfileCommand"), "UpdatePunkProfileCommand.commandId"),
      expectedRevision: _asInt(_requiredKey(json, "expectedRevision", "UpdatePunkProfileCommand"), "UpdatePunkProfileCommand.expectedRevision"),
      displayName: _asString(_requiredKey(json, "displayName", "UpdatePunkProfileCommand"), "UpdatePunkProfileCommand.displayName"),
      avatarUrl: _requiredKey(json, "avatarUrl", "UpdatePunkProfileCommand") == null ? null : _asString(_requiredKey(json, "avatarUrl", "UpdatePunkProfileCommand"), "UpdatePunkProfileCommand.avatarUrl"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "commandId": commandId,
      "expectedRevision": expectedRevision,
      "displayName": displayName,
      "avatarUrl": avatarUrl == null ? null : avatarUrl!,
    };
    return json;
  }
}

class PunkPublicSummary {
  final String punkId;
  final String displayName;
  final String? avatarUrl;

  const PunkPublicSummary({
    required this.punkId,
    required this.displayName,
    required this.avatarUrl,
  });

  factory PunkPublicSummary.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"punkId", "displayName", "avatarUrl"}, "PunkPublicSummary");
    return PunkPublicSummary(
      punkId: _asString(_requiredKey(json, "punkId", "PunkPublicSummary"), "PunkPublicSummary.punkId"),
      displayName: _asString(_requiredKey(json, "displayName", "PunkPublicSummary"), "PunkPublicSummary.displayName"),
      avatarUrl: _requiredKey(json, "avatarUrl", "PunkPublicSummary") == null ? null : _asString(_requiredKey(json, "avatarUrl", "PunkPublicSummary"), "PunkPublicSummary.avatarUrl"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "punkId": punkId,
      "displayName": displayName,
      "avatarUrl": avatarUrl == null ? null : avatarUrl!,
    };
    return json;
  }
}

class PunkSummaryBatchQuery {
  final String contract;
  final String workspaceId;
  final List<String> punkIds;

  const PunkSummaryBatchQuery({
    required this.contract,
    required this.workspaceId,
    required this.punkIds,
  });

  factory PunkSummaryBatchQuery.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspaceId", "punkIds"}, "PunkSummaryBatchQuery");
    return PunkSummaryBatchQuery(
      contract: _expectStringConst(_requiredKey(json, "contract", "PunkSummaryBatchQuery"), "punk.summary-batch@1", "PunkSummaryBatchQuery.contract"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "PunkSummaryBatchQuery"), "PunkSummaryBatchQuery.workspaceId"),
      punkIds: _asList(_requiredKey(json, "punkIds", "PunkSummaryBatchQuery"), "PunkSummaryBatchQuery.punkIds").map((item) => _asString(item, "PunkSummaryBatchQuery.punkIds[]")).toList(growable: false),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspaceId": workspaceId,
      "punkIds": punkIds.map((item) => item).toList(growable: false),
    };
    return json;
  }
}

class PunkSummaryBatchResponseSummary {
  final String punkId;
  final String displayName;
  final String? avatarUrl;

  const PunkSummaryBatchResponseSummary({
    required this.punkId,
    required this.displayName,
    required this.avatarUrl,
  });

  factory PunkSummaryBatchResponseSummary.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"punkId", "displayName", "avatarUrl"}, "PunkSummaryBatchResponseSummary");
    return PunkSummaryBatchResponseSummary(
      punkId: _asString(_requiredKey(json, "punkId", "PunkSummaryBatchResponseSummary"), "PunkSummaryBatchResponseSummary.punkId"),
      displayName: _asString(_requiredKey(json, "displayName", "PunkSummaryBatchResponseSummary"), "PunkSummaryBatchResponseSummary.displayName"),
      avatarUrl: _requiredKey(json, "avatarUrl", "PunkSummaryBatchResponseSummary") == null ? null : _asString(_requiredKey(json, "avatarUrl", "PunkSummaryBatchResponseSummary"), "PunkSummaryBatchResponseSummary.avatarUrl"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "punkId": punkId,
      "displayName": displayName,
      "avatarUrl": avatarUrl == null ? null : avatarUrl!,
    };
    return json;
  }
}

class PunkSummaryBatchResponse {
  final String contract;
  final String workspaceId;
  final List<PunkSummaryBatchResponseSummary> items;

  const PunkSummaryBatchResponse({
    required this.contract,
    required this.workspaceId,
    required this.items,
  });

  factory PunkSummaryBatchResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspaceId", "items"}, "PunkSummaryBatchResponse");
    return PunkSummaryBatchResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "PunkSummaryBatchResponse"), "punk.summary-batch-response@1", "PunkSummaryBatchResponse.contract"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "PunkSummaryBatchResponse"), "PunkSummaryBatchResponse.workspaceId"),
      items: _asList(_requiredKey(json, "items", "PunkSummaryBatchResponse"), "PunkSummaryBatchResponse.items").map((item) => PunkSummaryBatchResponseSummary.fromJson(_asMap(item, "PunkSummaryBatchResponse.items[]"))).toList(growable: false),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspaceId": workspaceId,
      "items": items.map((item) => item.toJson()).toList(growable: false),
    };
    return json;
  }
}

class PunkSearchQueryQueryPrefix extends PunkSearchQueryQuery {
  final String kind;
  final String value;

  const PunkSearchQueryQueryPrefix({
    required this.kind,
    required this.value,
  }) : super();

  factory PunkSearchQueryQueryPrefix.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "value"}, "PunkSearchQueryQueryPrefix");
    return PunkSearchQueryQueryPrefix(
      kind: _expectStringConst(_requiredKey(json, "kind", "PunkSearchQueryQueryPrefix"), "prefix", "PunkSearchQueryQueryPrefix.kind"),
      value: _asString(_requiredKey(json, "value", "PunkSearchQueryQueryPrefix"), "PunkSearchQueryQueryPrefix.value"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "value": value,
    };
    return json;
  }
}

class PunkSearchQueryQueryPunkId extends PunkSearchQueryQuery {
  final String kind;
  final String punkId;

  const PunkSearchQueryQueryPunkId({
    required this.kind,
    required this.punkId,
  }) : super();

  factory PunkSearchQueryQueryPunkId.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "PunkSearchQueryQueryPunkId");
    return PunkSearchQueryQueryPunkId(
      kind: _expectStringConst(_requiredKey(json, "kind", "PunkSearchQueryQueryPunkId"), "punk_id", "PunkSearchQueryQueryPunkId.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "PunkSearchQueryQueryPunkId"), "PunkSearchQueryQueryPunkId.punkId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

sealed class PunkSearchQueryQuery {
  const PunkSearchQueryQuery();

  factory PunkSearchQueryQuery.fromJson(Map<String, Object?> json) {
    switch (json["kind"]) {
      case "prefix":
        return PunkSearchQueryQueryPrefix.fromJson(json);
      case "punk_id":
        return PunkSearchQueryQueryPunkId.fromJson(json);
      default:
        throw FormatException('PunkSearchQueryQuery.kind has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class PunkSearchQuery {
  final String contract;
  final String workspaceId;
  final PunkSearchQueryQuery query;
  final int limit;
  final String? cursor;

  const PunkSearchQuery({
    required this.contract,
    required this.workspaceId,
    required this.query,
    required this.limit,
    required this.cursor,
  });

  factory PunkSearchQuery.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspaceId", "query", "limit", "cursor"}, "PunkSearchQuery");
    return PunkSearchQuery(
      contract: _expectStringConst(_requiredKey(json, "contract", "PunkSearchQuery"), "punk.search@1", "PunkSearchQuery.contract"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "PunkSearchQuery"), "PunkSearchQuery.workspaceId"),
      query: PunkSearchQueryQuery.fromJson(_asMap(_requiredKey(json, "query", "PunkSearchQuery"), "PunkSearchQuery.query")),
      limit: _asInt(_requiredKey(json, "limit", "PunkSearchQuery"), "PunkSearchQuery.limit"),
      cursor: _requiredKey(json, "cursor", "PunkSearchQuery") == null ? null : _asString(_requiredKey(json, "cursor", "PunkSearchQuery"), "PunkSearchQuery.cursor"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspaceId": workspaceId,
      "query": query.toJson(),
      "limit": limit,
      "cursor": cursor == null ? null : cursor!,
    };
    return json;
  }
}

class PunkSearchResponseSummary {
  final String punkId;
  final String displayName;
  final String? avatarUrl;

  const PunkSearchResponseSummary({
    required this.punkId,
    required this.displayName,
    required this.avatarUrl,
  });

  factory PunkSearchResponseSummary.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"punkId", "displayName", "avatarUrl"}, "PunkSearchResponseSummary");
    return PunkSearchResponseSummary(
      punkId: _asString(_requiredKey(json, "punkId", "PunkSearchResponseSummary"), "PunkSearchResponseSummary.punkId"),
      displayName: _asString(_requiredKey(json, "displayName", "PunkSearchResponseSummary"), "PunkSearchResponseSummary.displayName"),
      avatarUrl: _requiredKey(json, "avatarUrl", "PunkSearchResponseSummary") == null ? null : _asString(_requiredKey(json, "avatarUrl", "PunkSearchResponseSummary"), "PunkSearchResponseSummary.avatarUrl"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "punkId": punkId,
      "displayName": displayName,
      "avatarUrl": avatarUrl == null ? null : avatarUrl!,
    };
    return json;
  }
}

class PunkSearchResponse {
  final String contract;
  final String workspaceId;
  final List<PunkSearchResponseSummary> items;
  final String? nextCursor;

  const PunkSearchResponse({
    required this.contract,
    required this.workspaceId,
    required this.items,
    required this.nextCursor,
  });

  factory PunkSearchResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspaceId", "items", "nextCursor"}, "PunkSearchResponse");
    return PunkSearchResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "PunkSearchResponse"), "punk.search-response@1", "PunkSearchResponse.contract"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "PunkSearchResponse"), "PunkSearchResponse.workspaceId"),
      items: _asList(_requiredKey(json, "items", "PunkSearchResponse"), "PunkSearchResponse.items").map((item) => PunkSearchResponseSummary.fromJson(_asMap(item, "PunkSearchResponse.items[]"))).toList(growable: false),
      nextCursor: _requiredKey(json, "nextCursor", "PunkSearchResponse") == null ? null : _asString(_requiredKey(json, "nextCursor", "PunkSearchResponse"), "PunkSearchResponse.nextCursor"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspaceId": workspaceId,
      "items": items.map((item) => item.toJson()).toList(growable: false),
      "nextCursor": nextCursor == null ? null : nextCursor!,
    };
    return json;
  }
}

enum AccountMergeFreshProofAccountRole {
  survivor("survivor"),
  absorbed("absorbed"),
  ;

  const AccountMergeFreshProofAccountRole(this.value);

  final String value;

  factory AccountMergeFreshProofAccountRole.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergeFreshProofAccountRole value');
  }

  String toJson() => value;
}

enum AccountMergeFreshProofAuthenticationMethod {
  google("google"),
  github("github"),
  ;

  const AccountMergeFreshProofAuthenticationMethod(this.value);

  final String value;

  factory AccountMergeFreshProofAuthenticationMethod.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergeFreshProofAuthenticationMethod value');
  }

  String toJson() => value;
}

class AccountMergeFreshProof {
  final String contract;
  final String proofId;
  final String intentId;
  final AccountMergeFreshProofAccountRole accountRole;
  final String punkId;
  final int accountRevision;
  final String holderBindingHash;
  final AccountMergeFreshProofAuthenticationMethod authenticationMethod;
  final String providerSubjectBindingHash;
  final String authenticatedAt;
  final String expiresAt;
  final int validForSeconds;

  const AccountMergeFreshProof({
    required this.contract,
    required this.proofId,
    required this.intentId,
    required this.accountRole,
    required this.punkId,
    required this.accountRevision,
    required this.holderBindingHash,
    required this.authenticationMethod,
    required this.providerSubjectBindingHash,
    required this.authenticatedAt,
    required this.expiresAt,
    required this.validForSeconds,
  });

  factory AccountMergeFreshProof.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "proofId", "intentId", "accountRole", "punkId", "accountRevision", "holderBindingHash", "authenticationMethod", "providerSubjectBindingHash", "authenticatedAt", "expiresAt", "validForSeconds"}, "AccountMergeFreshProof");
    return AccountMergeFreshProof(
      contract: _expectStringConst(_requiredKey(json, "contract", "AccountMergeFreshProof"), "account-merge.fresh-proof@1", "AccountMergeFreshProof.contract"),
      proofId: _asString(_requiredKey(json, "proofId", "AccountMergeFreshProof"), "AccountMergeFreshProof.proofId"),
      intentId: _asString(_requiredKey(json, "intentId", "AccountMergeFreshProof"), "AccountMergeFreshProof.intentId"),
      accountRole: AccountMergeFreshProofAccountRole.fromJson(_requiredKey(json, "accountRole", "AccountMergeFreshProof"), "AccountMergeFreshProof.accountRole"),
      punkId: _asString(_requiredKey(json, "punkId", "AccountMergeFreshProof"), "AccountMergeFreshProof.punkId"),
      accountRevision: _asInt(_requiredKey(json, "accountRevision", "AccountMergeFreshProof"), "AccountMergeFreshProof.accountRevision"),
      holderBindingHash: _asString(_requiredKey(json, "holderBindingHash", "AccountMergeFreshProof"), "AccountMergeFreshProof.holderBindingHash"),
      authenticationMethod: AccountMergeFreshProofAuthenticationMethod.fromJson(_requiredKey(json, "authenticationMethod", "AccountMergeFreshProof"), "AccountMergeFreshProof.authenticationMethod"),
      providerSubjectBindingHash: _asString(_requiredKey(json, "providerSubjectBindingHash", "AccountMergeFreshProof"), "AccountMergeFreshProof.providerSubjectBindingHash"),
      authenticatedAt: _asString(_requiredKey(json, "authenticatedAt", "AccountMergeFreshProof"), "AccountMergeFreshProof.authenticatedAt"),
      expiresAt: _asString(_requiredKey(json, "expiresAt", "AccountMergeFreshProof"), "AccountMergeFreshProof.expiresAt"),
      validForSeconds: _expectIntConst(_requiredKey(json, "validForSeconds", "AccountMergeFreshProof"), 300, "AccountMergeFreshProof.validForSeconds"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "proofId": proofId,
      "intentId": intentId,
      "accountRole": accountRole.toJson(),
      "punkId": punkId,
      "accountRevision": accountRevision,
      "holderBindingHash": holderBindingHash,
      "authenticationMethod": authenticationMethod.toJson(),
      "providerSubjectBindingHash": providerSubjectBindingHash,
      "authenticatedAt": authenticatedAt,
      "expiresAt": expiresAt,
      "validForSeconds": validForSeconds,
    };
    return json;
  }
}

class CreateAccountMergePlanCommand {
  final String contract;
  final String commandId;
  final String intentId;
  final String survivorPunkId;
  final String absorbedPunkId;
  final String holderBindingHash;
  final List<AccountMergeFreshProof> proofs;

  const CreateAccountMergePlanCommand({
    required this.contract,
    required this.commandId,
    required this.intentId,
    required this.survivorPunkId,
    required this.absorbedPunkId,
    required this.holderBindingHash,
    required this.proofs,
  });

  factory CreateAccountMergePlanCommand.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "commandId", "intentId", "survivorPunkId", "absorbedPunkId", "holderBindingHash", "proofs"}, "CreateAccountMergePlanCommand");
    return CreateAccountMergePlanCommand(
      contract: _expectStringConst(_requiredKey(json, "contract", "CreateAccountMergePlanCommand"), "account-merge.plan-create@1", "CreateAccountMergePlanCommand.contract"),
      commandId: _asString(_requiredKey(json, "commandId", "CreateAccountMergePlanCommand"), "CreateAccountMergePlanCommand.commandId"),
      intentId: _asString(_requiredKey(json, "intentId", "CreateAccountMergePlanCommand"), "CreateAccountMergePlanCommand.intentId"),
      survivorPunkId: _asString(_requiredKey(json, "survivorPunkId", "CreateAccountMergePlanCommand"), "CreateAccountMergePlanCommand.survivorPunkId"),
      absorbedPunkId: _asString(_requiredKey(json, "absorbedPunkId", "CreateAccountMergePlanCommand"), "CreateAccountMergePlanCommand.absorbedPunkId"),
      holderBindingHash: _asString(_requiredKey(json, "holderBindingHash", "CreateAccountMergePlanCommand"), "CreateAccountMergePlanCommand.holderBindingHash"),
      proofs: _asList(_requiredKey(json, "proofs", "CreateAccountMergePlanCommand"), "CreateAccountMergePlanCommand.proofs").map((item) => AccountMergeFreshProof.fromJson(_asMap(item, "CreateAccountMergePlanCommand.proofs[]"))).toList(growable: false),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "commandId": commandId,
      "intentId": intentId,
      "survivorPunkId": survivorPunkId,
      "absorbedPunkId": absorbedPunkId,
      "holderBindingHash": holderBindingHash,
      "proofs": proofs.map((item) => item.toJson()).toList(growable: false),
    };
    return json;
  }
}

class AccountMergePlanAccountRevisions {
  final int survivor;
  final int absorbed;

  const AccountMergePlanAccountRevisions({
    required this.survivor,
    required this.absorbed,
  });

  factory AccountMergePlanAccountRevisions.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"survivor", "absorbed"}, "AccountMergePlanAccountRevisions");
    return AccountMergePlanAccountRevisions(
      survivor: _asInt(_requiredKey(json, "survivor", "AccountMergePlanAccountRevisions"), "AccountMergePlanAccountRevisions.survivor"),
      absorbed: _asInt(_requiredKey(json, "absorbed", "AccountMergePlanAccountRevisions"), "AccountMergePlanAccountRevisions.absorbed"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "survivor": survivor,
      "absorbed": absorbed,
    };
    return json;
  }
}

class AccountMergePlanProofBindings {
  final String survivorProofId;
  final String absorbedProofId;

  const AccountMergePlanProofBindings({
    required this.survivorProofId,
    required this.absorbedProofId,
  });

  factory AccountMergePlanProofBindings.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"survivorProofId", "absorbedProofId"}, "AccountMergePlanProofBindings");
    return AccountMergePlanProofBindings(
      survivorProofId: _asString(_requiredKey(json, "survivorProofId", "AccountMergePlanProofBindings"), "AccountMergePlanProofBindings.survivorProofId"),
      absorbedProofId: _asString(_requiredKey(json, "absorbedProofId", "AccountMergePlanProofBindings"), "AccountMergePlanProofBindings.absorbedProofId"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "survivorProofId": survivorProofId,
      "absorbedProofId": absorbedProofId,
    };
    return json;
  }
}

enum AccountMergePlanClaimEffectKind {
  providerSubject("provider-subject"),
  verifiedEmail("verified-email"),
  passkeyCredential("passkey-credential"),
  ;

  const AccountMergePlanClaimEffectKind(this.value);

  final String value;

  factory AccountMergePlanClaimEffectKind.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergePlanClaimEffectKind value');
  }

  String toJson() => value;
}

enum AccountMergePlanClaimEffectProvider {
  google("google"),
  github("github"),
  passkey("passkey"),
  ;

  const AccountMergePlanClaimEffectProvider(this.value);

  final String value;

  factory AccountMergePlanClaimEffectProvider.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergePlanClaimEffectProvider value');
  }

  String toJson() => value;
}

enum AccountMergePlanOrigin {
  survivor("survivor"),
  absorbed("absorbed"),
  ;

  const AccountMergePlanOrigin(this.value);

  final String value;

  factory AccountMergePlanOrigin.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergePlanOrigin value');
  }

  String toJson() => value;
}

enum AccountMergePlanClaimEffectDisposition {
  preserve("preserve"),
  transfer("transfer"),
  deduplicate("deduplicate"),
  ;

  const AccountMergePlanClaimEffectDisposition(this.value);

  final String value;

  factory AccountMergePlanClaimEffectDisposition.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergePlanClaimEffectDisposition value');
  }

  String toJson() => value;
}

class AccountMergePlanClaimEffect {
  final String claimBindingHash;
  final AccountMergePlanClaimEffectKind kind;
  final AccountMergePlanClaimEffectProvider provider;
  final AccountMergePlanOrigin origin;
  final AccountMergePlanClaimEffectDisposition disposition;
  final String? duplicateOfBindingHash;
  final int expectedRevision;

  const AccountMergePlanClaimEffect({
    required this.claimBindingHash,
    required this.kind,
    required this.provider,
    required this.origin,
    required this.disposition,
    required this.duplicateOfBindingHash,
    required this.expectedRevision,
  });

  factory AccountMergePlanClaimEffect.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"claimBindingHash", "kind", "provider", "origin", "disposition", "duplicateOfBindingHash", "expectedRevision"}, "AccountMergePlanClaimEffect");
    return AccountMergePlanClaimEffect(
      claimBindingHash: _asString(_requiredKey(json, "claimBindingHash", "AccountMergePlanClaimEffect"), "AccountMergePlanClaimEffect.claimBindingHash"),
      kind: AccountMergePlanClaimEffectKind.fromJson(_requiredKey(json, "kind", "AccountMergePlanClaimEffect"), "AccountMergePlanClaimEffect.kind"),
      provider: AccountMergePlanClaimEffectProvider.fromJson(_requiredKey(json, "provider", "AccountMergePlanClaimEffect"), "AccountMergePlanClaimEffect.provider"),
      origin: AccountMergePlanOrigin.fromJson(_requiredKey(json, "origin", "AccountMergePlanClaimEffect"), "AccountMergePlanClaimEffect.origin"),
      disposition: AccountMergePlanClaimEffectDisposition.fromJson(_requiredKey(json, "disposition", "AccountMergePlanClaimEffect"), "AccountMergePlanClaimEffect.disposition"),
      duplicateOfBindingHash: _requiredKey(json, "duplicateOfBindingHash", "AccountMergePlanClaimEffect") == null ? null : _asString(_requiredKey(json, "duplicateOfBindingHash", "AccountMergePlanClaimEffect"), "AccountMergePlanClaimEffect.duplicateOfBindingHash"),
      expectedRevision: _asInt(_requiredKey(json, "expectedRevision", "AccountMergePlanClaimEffect"), "AccountMergePlanClaimEffect.expectedRevision"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "claimBindingHash": claimBindingHash,
      "kind": kind.toJson(),
      "provider": provider.toJson(),
      "origin": origin.toJson(),
      "disposition": disposition.toJson(),
      "duplicateOfBindingHash": duplicateOfBindingHash == null ? null : duplicateOfBindingHash!,
      "expectedRevision": expectedRevision,
    };
    return json;
  }
}

enum AccountMergePlanRightEffectKind {
  workspaceMembership("workspace-membership"),
  workspaceInvitation("workspace-invitation"),
  accountOwnedResource("account-owned-resource"),
  localResourceBinding("local-resource-binding"),
  localToolAuthorization("local-tool-authorization"),
  repositoryAccessProof("repository-access-proof"),
  ;

  const AccountMergePlanRightEffectKind(this.value);

  final String value;

  factory AccountMergePlanRightEffectKind.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergePlanRightEffectKind value');
  }

  String toJson() => value;
}

enum AccountMergePlanRightEffectDisposition {
  preserve("preserve"),
  transfer("transfer"),
  deduplicate("deduplicate"),
  retarget("retarget"),
  invalidate("invalidate"),
  ;

  const AccountMergePlanRightEffectDisposition(this.value);

  final String value;

  factory AccountMergePlanRightEffectDisposition.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergePlanRightEffectDisposition value');
  }

  String toJson() => value;
}

enum AccountMergePlanRightEffectRole {
  owner("owner"),
  moderator("moderator"),
  member("member"),
  guest("guest"),
  ;

  const AccountMergePlanRightEffectRole(this.value);

  final String value;

  factory AccountMergePlanRightEffectRole.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergePlanRightEffectRole value');
  }

  String toJson() => value;
}

enum AccountMergePlanRightEffectResultingRole {
  owner("owner"),
  moderator("moderator"),
  member("member"),
  guest("guest"),
  ;

  const AccountMergePlanRightEffectResultingRole(this.value);

  final String value;

  factory AccountMergePlanRightEffectResultingRole.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergePlanRightEffectResultingRole value');
  }

  String toJson() => value;
}

class AccountMergePlanRightEffect {
  final String rightBindingHash;
  final AccountMergePlanRightEffectKind kind;
  final String authorityBindingHash;
  final AccountMergePlanOrigin origin;
  final String originPunkId;
  final AccountMergePlanRightEffectDisposition disposition;
  final AccountMergePlanRightEffectRole? role;
  final AccountMergePlanRightEffectResultingRole? resultingRole;
  final int expectedRevision;

  const AccountMergePlanRightEffect({
    required this.rightBindingHash,
    required this.kind,
    required this.authorityBindingHash,
    required this.origin,
    required this.originPunkId,
    required this.disposition,
    required this.role,
    required this.resultingRole,
    required this.expectedRevision,
  });

  factory AccountMergePlanRightEffect.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"rightBindingHash", "kind", "authorityBindingHash", "origin", "originPunkId", "disposition", "role", "resultingRole", "expectedRevision"}, "AccountMergePlanRightEffect");
    return AccountMergePlanRightEffect(
      rightBindingHash: _asString(_requiredKey(json, "rightBindingHash", "AccountMergePlanRightEffect"), "AccountMergePlanRightEffect.rightBindingHash"),
      kind: AccountMergePlanRightEffectKind.fromJson(_requiredKey(json, "kind", "AccountMergePlanRightEffect"), "AccountMergePlanRightEffect.kind"),
      authorityBindingHash: _asString(_requiredKey(json, "authorityBindingHash", "AccountMergePlanRightEffect"), "AccountMergePlanRightEffect.authorityBindingHash"),
      origin: AccountMergePlanOrigin.fromJson(_requiredKey(json, "origin", "AccountMergePlanRightEffect"), "AccountMergePlanRightEffect.origin"),
      originPunkId: _asString(_requiredKey(json, "originPunkId", "AccountMergePlanRightEffect"), "AccountMergePlanRightEffect.originPunkId"),
      disposition: AccountMergePlanRightEffectDisposition.fromJson(_requiredKey(json, "disposition", "AccountMergePlanRightEffect"), "AccountMergePlanRightEffect.disposition"),
      role: _requiredKey(json, "role", "AccountMergePlanRightEffect") == null ? null : AccountMergePlanRightEffectRole.fromJson(_requiredKey(json, "role", "AccountMergePlanRightEffect"), "AccountMergePlanRightEffect.role"),
      resultingRole: _requiredKey(json, "resultingRole", "AccountMergePlanRightEffect") == null ? null : AccountMergePlanRightEffectResultingRole.fromJson(_requiredKey(json, "resultingRole", "AccountMergePlanRightEffect"), "AccountMergePlanRightEffect.resultingRole"),
      expectedRevision: _asInt(_requiredKey(json, "expectedRevision", "AccountMergePlanRightEffect"), "AccountMergePlanRightEffect.expectedRevision"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "rightBindingHash": rightBindingHash,
      "kind": kind.toJson(),
      "authorityBindingHash": authorityBindingHash,
      "origin": origin.toJson(),
      "originPunkId": originPunkId,
      "disposition": disposition.toJson(),
      "role": role == null ? null : role!.toJson(),
      "resultingRole": resultingRole == null ? null : resultingRole!.toJson(),
      "expectedRevision": expectedRevision,
    };
    return json;
  }
}

enum AccountMergePlanSessionEffectClientKind {
  browser("browser"),
  desktop("desktop"),
  mobile("mobile"),
  api("api"),
  ;

  const AccountMergePlanSessionEffectClientKind(this.value);

  final String value;

  factory AccountMergePlanSessionEffectClientKind.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergePlanSessionEffectClientKind value');
  }

  String toJson() => value;
}

class AccountMergePlanSessionEffect {
  final String sessionBindingHash;
  final AccountMergePlanOrigin origin;
  final AccountMergePlanSessionEffectClientKind clientKind;
  final String action;
  final String authenticatedAt;
  final String expiresAt;

  const AccountMergePlanSessionEffect({
    required this.sessionBindingHash,
    required this.origin,
    required this.clientKind,
    required this.action,
    required this.authenticatedAt,
    required this.expiresAt,
  });

  factory AccountMergePlanSessionEffect.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"sessionBindingHash", "origin", "clientKind", "action", "authenticatedAt", "expiresAt"}, "AccountMergePlanSessionEffect");
    return AccountMergePlanSessionEffect(
      sessionBindingHash: _asString(_requiredKey(json, "sessionBindingHash", "AccountMergePlanSessionEffect"), "AccountMergePlanSessionEffect.sessionBindingHash"),
      origin: AccountMergePlanOrigin.fromJson(_requiredKey(json, "origin", "AccountMergePlanSessionEffect"), "AccountMergePlanSessionEffect.origin"),
      clientKind: AccountMergePlanSessionEffectClientKind.fromJson(_requiredKey(json, "clientKind", "AccountMergePlanSessionEffect"), "AccountMergePlanSessionEffect.clientKind"),
      action: _expectStringConst(_requiredKey(json, "action", "AccountMergePlanSessionEffect"), "revoke", "AccountMergePlanSessionEffect.action"),
      authenticatedAt: _asString(_requiredKey(json, "authenticatedAt", "AccountMergePlanSessionEffect"), "AccountMergePlanSessionEffect.authenticatedAt"),
      expiresAt: _asString(_requiredKey(json, "expiresAt", "AccountMergePlanSessionEffect"), "AccountMergePlanSessionEffect.expiresAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "sessionBindingHash": sessionBindingHash,
      "origin": origin.toJson(),
      "clientKind": clientKind.toJson(),
      "action": action,
      "authenticatedAt": authenticatedAt,
      "expiresAt": expiresAt,
    };
    return json;
  }
}

enum AccountMergePlanHandoffEffectKind {
  desktopAuthFlow("desktop-auth-flow"),
  oauthTransaction("oauth-transaction"),
  passkeyCeremony("passkey-ceremony"),
  reauthAuthorization("reauth-authorization"),
  sessionRenewal("session-renewal"),
  accountLink("account-link"),
  ;

  const AccountMergePlanHandoffEffectKind(this.value);

  final String value;

  factory AccountMergePlanHandoffEffectKind.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergePlanHandoffEffectKind value');
  }

  String toJson() => value;
}

enum AccountMergePlanHandoffEffectState {
  pending("pending"),
  prepared("prepared"),
  deliverable("deliverable"),
  ;

  const AccountMergePlanHandoffEffectState(this.value);

  final String value;

  factory AccountMergePlanHandoffEffectState.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergePlanHandoffEffectState value');
  }

  String toJson() => value;
}

class AccountMergePlanHandoffEffect {
  final String handoffBindingHash;
  final AccountMergePlanOrigin origin;
  final AccountMergePlanHandoffEffectKind kind;
  final AccountMergePlanHandoffEffectState state;
  final String action;
  final String expiresAt;

  const AccountMergePlanHandoffEffect({
    required this.handoffBindingHash,
    required this.origin,
    required this.kind,
    required this.state,
    required this.action,
    required this.expiresAt,
  });

  factory AccountMergePlanHandoffEffect.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"handoffBindingHash", "origin", "kind", "state", "action", "expiresAt"}, "AccountMergePlanHandoffEffect");
    return AccountMergePlanHandoffEffect(
      handoffBindingHash: _asString(_requiredKey(json, "handoffBindingHash", "AccountMergePlanHandoffEffect"), "AccountMergePlanHandoffEffect.handoffBindingHash"),
      origin: AccountMergePlanOrigin.fromJson(_requiredKey(json, "origin", "AccountMergePlanHandoffEffect"), "AccountMergePlanHandoffEffect.origin"),
      kind: AccountMergePlanHandoffEffectKind.fromJson(_requiredKey(json, "kind", "AccountMergePlanHandoffEffect"), "AccountMergePlanHandoffEffect.kind"),
      state: AccountMergePlanHandoffEffectState.fromJson(_requiredKey(json, "state", "AccountMergePlanHandoffEffect"), "AccountMergePlanHandoffEffect.state"),
      action: _expectStringConst(_requiredKey(json, "action", "AccountMergePlanHandoffEffect"), "cancel", "AccountMergePlanHandoffEffect.action"),
      expiresAt: _asString(_requiredKey(json, "expiresAt", "AccountMergePlanHandoffEffect"), "AccountMergePlanHandoffEffect.expiresAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "handoffBindingHash": handoffBindingHash,
      "origin": origin.toJson(),
      "kind": kind.toJson(),
      "state": state.toJson(),
      "action": action,
      "expiresAt": expiresAt,
    };
    return json;
  }
}

enum AccountMergePlanConflictKind {
  identicalClaim("identical-claim"),
  workspaceRole("workspace-role"),
  workspaceOwner("workspace-owner"),
  duplicateInvitation("duplicate-invitation"),
  accountOwnedResource("account-owned-resource"),
  inFlightSensitiveAction("in-flight-sensitive-action"),
  missingStrategy("missing-strategy"),
  aliasCycle("alias-cycle"),
  authorityUnavailable("authority-unavailable"),
  ;

  const AccountMergePlanConflictKind(this.value);

  final String value;

  factory AccountMergePlanConflictKind.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergePlanConflictKind value');
  }

  String toJson() => value;
}

enum AccountMergePlanConflictResolution {
  deduplicate("deduplicate"),
  strongestRole("strongest-role"),
  retargetInvitation("retarget-invitation"),
  preserveWorkspaceOwnership("preserve-workspace-ownership"),
  awaitTerminal("await-terminal"),
  requiresAdapter("requires-adapter"),
  rejectPlan("reject-plan"),
  ;

  const AccountMergePlanConflictResolution(this.value);

  final String value;

  factory AccountMergePlanConflictResolution.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergePlanConflictResolution value');
  }

  String toJson() => value;
}

class AccountMergePlanConflict {
  final String conflictBindingHash;
  final AccountMergePlanConflictKind kind;
  final String authorityBindingHash;
  final AccountMergePlanConflictResolution resolution;
  final bool blocking;

  const AccountMergePlanConflict({
    required this.conflictBindingHash,
    required this.kind,
    required this.authorityBindingHash,
    required this.resolution,
    required this.blocking,
  });

  factory AccountMergePlanConflict.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"conflictBindingHash", "kind", "authorityBindingHash", "resolution", "blocking"}, "AccountMergePlanConflict");
    return AccountMergePlanConflict(
      conflictBindingHash: _asString(_requiredKey(json, "conflictBindingHash", "AccountMergePlanConflict"), "AccountMergePlanConflict.conflictBindingHash"),
      kind: AccountMergePlanConflictKind.fromJson(_requiredKey(json, "kind", "AccountMergePlanConflict"), "AccountMergePlanConflict.kind"),
      authorityBindingHash: _asString(_requiredKey(json, "authorityBindingHash", "AccountMergePlanConflict"), "AccountMergePlanConflict.authorityBindingHash"),
      resolution: AccountMergePlanConflictResolution.fromJson(_requiredKey(json, "resolution", "AccountMergePlanConflict"), "AccountMergePlanConflict.resolution"),
      blocking: _asBool(_requiredKey(json, "blocking", "AccountMergePlanConflict"), "AccountMergePlanConflict.blocking"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "conflictBindingHash": conflictBindingHash,
      "kind": kind.toJson(),
      "authorityBindingHash": authorityBindingHash,
      "resolution": resolution.toJson(),
      "blocking": blocking,
    };
    return json;
  }
}

class AccountMergePlan {
  final String contract;
  final int schemaVersion;
  final String planId;
  final String intentId;
  final String planDigest;
  final String status;
  final String generatedAt;
  final String expiresAt;
  final int validForSeconds;
  final String holderBindingHash;
  final String strategy;
  final String survivorPunkId;
  final String absorbedPunkId;
  final AccountMergePlanAccountRevisions accountRevisions;
  final AccountMergePlanProofBindings proofBindings;
  final List<AccountMergePlanClaimEffect> claims;
  final List<AccountMergePlanRightEffect> rights;
  final List<AccountMergePlanSessionEffect> sessions;
  final List<AccountMergePlanHandoffEffect> handoffs;
  final List<AccountMergePlanConflict> conflicts;

  const AccountMergePlan({
    required this.contract,
    required this.schemaVersion,
    required this.planId,
    required this.intentId,
    required this.planDigest,
    required this.status,
    required this.generatedAt,
    required this.expiresAt,
    required this.validForSeconds,
    required this.holderBindingHash,
    required this.strategy,
    required this.survivorPunkId,
    required this.absorbedPunkId,
    required this.accountRevisions,
    required this.proofBindings,
    required this.claims,
    required this.rights,
    required this.sessions,
    required this.handoffs,
    required this.conflicts,
  });

  factory AccountMergePlan.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "schemaVersion", "planId", "intentId", "planDigest", "status", "generatedAt", "expiresAt", "validForSeconds", "holderBindingHash", "strategy", "survivorPunkId", "absorbedPunkId", "accountRevisions", "proofBindings", "claims", "rights", "sessions", "handoffs", "conflicts"}, "AccountMergePlan");
    return AccountMergePlan(
      contract: _expectStringConst(_requiredKey(json, "contract", "AccountMergePlan"), "account-merge.plan@1", "AccountMergePlan.contract"),
      schemaVersion: _expectIntConst(_requiredKey(json, "schemaVersion", "AccountMergePlan"), 1, "AccountMergePlan.schemaVersion"),
      planId: _asString(_requiredKey(json, "planId", "AccountMergePlan"), "AccountMergePlan.planId"),
      intentId: _asString(_requiredKey(json, "intentId", "AccountMergePlan"), "AccountMergePlan.intentId"),
      planDigest: _asString(_requiredKey(json, "planDigest", "AccountMergePlan"), "AccountMergePlan.planDigest"),
      status: _expectStringConst(_requiredKey(json, "status", "AccountMergePlan"), "planned", "AccountMergePlan.status"),
      generatedAt: _asString(_requiredKey(json, "generatedAt", "AccountMergePlan"), "AccountMergePlan.generatedAt"),
      expiresAt: _asString(_requiredKey(json, "expiresAt", "AccountMergePlan"), "AccountMergePlan.expiresAt"),
      validForSeconds: _asInt(_requiredKey(json, "validForSeconds", "AccountMergePlan"), "AccountMergePlan.validForSeconds"),
      holderBindingHash: _asString(_requiredKey(json, "holderBindingHash", "AccountMergePlan"), "AccountMergePlan.holderBindingHash"),
      strategy: _expectStringConst(_requiredKey(json, "strategy", "AccountMergePlan"), "preserve-origin", "AccountMergePlan.strategy"),
      survivorPunkId: _asString(_requiredKey(json, "survivorPunkId", "AccountMergePlan"), "AccountMergePlan.survivorPunkId"),
      absorbedPunkId: _asString(_requiredKey(json, "absorbedPunkId", "AccountMergePlan"), "AccountMergePlan.absorbedPunkId"),
      accountRevisions: AccountMergePlanAccountRevisions.fromJson(_asMap(_requiredKey(json, "accountRevisions", "AccountMergePlan"), "AccountMergePlan.accountRevisions")),
      proofBindings: AccountMergePlanProofBindings.fromJson(_asMap(_requiredKey(json, "proofBindings", "AccountMergePlan"), "AccountMergePlan.proofBindings")),
      claims: _asList(_requiredKey(json, "claims", "AccountMergePlan"), "AccountMergePlan.claims").map((item) => AccountMergePlanClaimEffect.fromJson(_asMap(item, "AccountMergePlan.claims[]"))).toList(growable: false),
      rights: _asList(_requiredKey(json, "rights", "AccountMergePlan"), "AccountMergePlan.rights").map((item) => AccountMergePlanRightEffect.fromJson(_asMap(item, "AccountMergePlan.rights[]"))).toList(growable: false),
      sessions: _asList(_requiredKey(json, "sessions", "AccountMergePlan"), "AccountMergePlan.sessions").map((item) => AccountMergePlanSessionEffect.fromJson(_asMap(item, "AccountMergePlan.sessions[]"))).toList(growable: false),
      handoffs: _asList(_requiredKey(json, "handoffs", "AccountMergePlan"), "AccountMergePlan.handoffs").map((item) => AccountMergePlanHandoffEffect.fromJson(_asMap(item, "AccountMergePlan.handoffs[]"))).toList(growable: false),
      conflicts: _asList(_requiredKey(json, "conflicts", "AccountMergePlan"), "AccountMergePlan.conflicts").map((item) => AccountMergePlanConflict.fromJson(_asMap(item, "AccountMergePlan.conflicts[]"))).toList(growable: false),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "schemaVersion": schemaVersion,
      "planId": planId,
      "intentId": intentId,
      "planDigest": planDigest,
      "status": status,
      "generatedAt": generatedAt,
      "expiresAt": expiresAt,
      "validForSeconds": validForSeconds,
      "holderBindingHash": holderBindingHash,
      "strategy": strategy,
      "survivorPunkId": survivorPunkId,
      "absorbedPunkId": absorbedPunkId,
      "accountRevisions": accountRevisions.toJson(),
      "proofBindings": proofBindings.toJson(),
      "claims": claims.map((item) => item.toJson()).toList(growable: false),
      "rights": rights.map((item) => item.toJson()).toList(growable: false),
      "sessions": sessions.map((item) => item.toJson()).toList(growable: false),
      "handoffs": handoffs.map((item) => item.toJson()).toList(growable: false),
      "conflicts": conflicts.map((item) => item.toJson()).toList(growable: false),
    };
    return json;
  }
}

class AccountMergePlanResponseTrue extends AccountMergePlanResponse {
  final String contract;
  final bool ok;
  final String status;
  final AccountMergePlan plan;

  const AccountMergePlanResponseTrue({
    required this.contract,
    required this.ok,
    required this.status,
    required this.plan,
  }) : super();

  factory AccountMergePlanResponseTrue.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "ok", "status", "plan"}, "AccountMergePlanResponseTrue");
    return AccountMergePlanResponseTrue(
      contract: _expectStringConst(_requiredKey(json, "contract", "AccountMergePlanResponseTrue"), "account-merge.plan-response@1", "AccountMergePlanResponseTrue.contract"),
      ok: _expectBoolConst(_requiredKey(json, "ok", "AccountMergePlanResponseTrue"), true, "AccountMergePlanResponseTrue.ok"),
      status: _expectStringConst(_requiredKey(json, "status", "AccountMergePlanResponseTrue"), "planned", "AccountMergePlanResponseTrue.status"),
      plan: AccountMergePlan.fromJson(_asMap(_requiredKey(json, "plan", "AccountMergePlanResponseTrue"), "AccountMergePlanResponseTrue.plan")),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "ok": ok,
      "status": status,
      "plan": plan.toJson(),
    };
    return json;
  }
}

class AccountMergePlanResponseFalse extends AccountMergePlanResponse {
  final String contract;
  final bool ok;
  final String code;
  final String correlationId;

  const AccountMergePlanResponseFalse({
    required this.contract,
    required this.ok,
    required this.code,
    required this.correlationId,
  }) : super();

  factory AccountMergePlanResponseFalse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "ok", "code", "correlationId"}, "AccountMergePlanResponseFalse");
    return AccountMergePlanResponseFalse(
      contract: _expectStringConst(_requiredKey(json, "contract", "AccountMergePlanResponseFalse"), "account-merge.plan-response@1", "AccountMergePlanResponseFalse.contract"),
      ok: _expectBoolConst(_requiredKey(json, "ok", "AccountMergePlanResponseFalse"), false, "AccountMergePlanResponseFalse.ok"),
      code: _expectStringConst(_requiredKey(json, "code", "AccountMergePlanResponseFalse"), "plan_unavailable", "AccountMergePlanResponseFalse.code"),
      correlationId: _asString(_requiredKey(json, "correlationId", "AccountMergePlanResponseFalse"), "AccountMergePlanResponseFalse.correlationId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "ok": ok,
      "code": code,
      "correlationId": correlationId,
    };
    return json;
  }
}

sealed class AccountMergePlanResponse {
  const AccountMergePlanResponse();

  factory AccountMergePlanResponse.fromJson(Map<String, Object?> json) {
    switch (json["ok"]) {
      case true:
        return AccountMergePlanResponseTrue.fromJson(json);
      case false:
        return AccountMergePlanResponseFalse.fromJson(json);
      default:
        throw FormatException('AccountMergePlanResponse.ok has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class CommitAccountMergeCommandAccountRevisions {
  final int survivor;
  final int absorbed;

  const CommitAccountMergeCommandAccountRevisions({
    required this.survivor,
    required this.absorbed,
  });

  factory CommitAccountMergeCommandAccountRevisions.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"survivor", "absorbed"}, "CommitAccountMergeCommandAccountRevisions");
    return CommitAccountMergeCommandAccountRevisions(
      survivor: _asInt(_requiredKey(json, "survivor", "CommitAccountMergeCommandAccountRevisions"), "CommitAccountMergeCommandAccountRevisions.survivor"),
      absorbed: _asInt(_requiredKey(json, "absorbed", "CommitAccountMergeCommandAccountRevisions"), "CommitAccountMergeCommandAccountRevisions.absorbed"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "survivor": survivor,
      "absorbed": absorbed,
    };
    return json;
  }
}

class CommitAccountMergeCommand {
  final String contract;
  final String commandId;
  final String intentId;
  final String planId;
  final String planDigest;
  final String survivorPunkId;
  final String absorbedPunkId;
  final CommitAccountMergeCommandAccountRevisions accountRevisions;
  final String confirmation;

  const CommitAccountMergeCommand({
    required this.contract,
    required this.commandId,
    required this.intentId,
    required this.planId,
    required this.planDigest,
    required this.survivorPunkId,
    required this.absorbedPunkId,
    required this.accountRevisions,
    required this.confirmation,
  });

  factory CommitAccountMergeCommand.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "commandId", "intentId", "planId", "planDigest", "survivorPunkId", "absorbedPunkId", "accountRevisions", "confirmation"}, "CommitAccountMergeCommand");
    return CommitAccountMergeCommand(
      contract: _expectStringConst(_requiredKey(json, "contract", "CommitAccountMergeCommand"), "account-merge.commit@1", "CommitAccountMergeCommand.contract"),
      commandId: _asString(_requiredKey(json, "commandId", "CommitAccountMergeCommand"), "CommitAccountMergeCommand.commandId"),
      intentId: _asString(_requiredKey(json, "intentId", "CommitAccountMergeCommand"), "CommitAccountMergeCommand.intentId"),
      planId: _asString(_requiredKey(json, "planId", "CommitAccountMergeCommand"), "CommitAccountMergeCommand.planId"),
      planDigest: _asString(_requiredKey(json, "planDigest", "CommitAccountMergeCommand"), "CommitAccountMergeCommand.planDigest"),
      survivorPunkId: _asString(_requiredKey(json, "survivorPunkId", "CommitAccountMergeCommand"), "CommitAccountMergeCommand.survivorPunkId"),
      absorbedPunkId: _asString(_requiredKey(json, "absorbedPunkId", "CommitAccountMergeCommand"), "CommitAccountMergeCommand.absorbedPunkId"),
      accountRevisions: CommitAccountMergeCommandAccountRevisions.fromJson(_asMap(_requiredKey(json, "accountRevisions", "CommitAccountMergeCommand"), "CommitAccountMergeCommand.accountRevisions")),
      confirmation: _expectStringConst(_requiredKey(json, "confirmation", "CommitAccountMergeCommand"), "merge_accounts_irreversibly", "CommitAccountMergeCommand.confirmation"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "commandId": commandId,
      "intentId": intentId,
      "planId": planId,
      "planDigest": planDigest,
      "survivorPunkId": survivorPunkId,
      "absorbedPunkId": absorbedPunkId,
      "accountRevisions": accountRevisions.toJson(),
      "confirmation": confirmation,
    };
    return json;
  }
}

class AccountMergeReceiptAccountRevisions {
  final int survivor;
  final int absorbed;

  const AccountMergeReceiptAccountRevisions({
    required this.survivor,
    required this.absorbed,
  });

  factory AccountMergeReceiptAccountRevisions.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"survivor", "absorbed"}, "AccountMergeReceiptAccountRevisions");
    return AccountMergeReceiptAccountRevisions(
      survivor: _asInt(_requiredKey(json, "survivor", "AccountMergeReceiptAccountRevisions"), "AccountMergeReceiptAccountRevisions.survivor"),
      absorbed: _asInt(_requiredKey(json, "absorbed", "AccountMergeReceiptAccountRevisions"), "AccountMergeReceiptAccountRevisions.absorbed"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "survivor": survivor,
      "absorbed": absorbed,
    };
    return json;
  }
}

class AccountMergeReceipt {
  final String contract;
  final int schemaVersion;
  final String receiptId;
  final String intentId;
  final String planId;
  final String planDigest;
  final String commitCommandId;
  final String survivorPunkId;
  final String absorbedPunkId;
  final AccountMergeReceiptAccountRevisions accountRevisions;
  final String committedAt;
  final String receiptHash;

  const AccountMergeReceipt({
    required this.contract,
    required this.schemaVersion,
    required this.receiptId,
    required this.intentId,
    required this.planId,
    required this.planDigest,
    required this.commitCommandId,
    required this.survivorPunkId,
    required this.absorbedPunkId,
    required this.accountRevisions,
    required this.committedAt,
    required this.receiptHash,
  });

  factory AccountMergeReceipt.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "schemaVersion", "receiptId", "intentId", "planId", "planDigest", "commitCommandId", "survivorPunkId", "absorbedPunkId", "accountRevisions", "committedAt", "receiptHash"}, "AccountMergeReceipt");
    return AccountMergeReceipt(
      contract: _expectStringConst(_requiredKey(json, "contract", "AccountMergeReceipt"), "account-merge.receipt@1", "AccountMergeReceipt.contract"),
      schemaVersion: _expectIntConst(_requiredKey(json, "schemaVersion", "AccountMergeReceipt"), 1, "AccountMergeReceipt.schemaVersion"),
      receiptId: _asString(_requiredKey(json, "receiptId", "AccountMergeReceipt"), "AccountMergeReceipt.receiptId"),
      intentId: _asString(_requiredKey(json, "intentId", "AccountMergeReceipt"), "AccountMergeReceipt.intentId"),
      planId: _asString(_requiredKey(json, "planId", "AccountMergeReceipt"), "AccountMergeReceipt.planId"),
      planDigest: _asString(_requiredKey(json, "planDigest", "AccountMergeReceipt"), "AccountMergeReceipt.planDigest"),
      commitCommandId: _asString(_requiredKey(json, "commitCommandId", "AccountMergeReceipt"), "AccountMergeReceipt.commitCommandId"),
      survivorPunkId: _asString(_requiredKey(json, "survivorPunkId", "AccountMergeReceipt"), "AccountMergeReceipt.survivorPunkId"),
      absorbedPunkId: _asString(_requiredKey(json, "absorbedPunkId", "AccountMergeReceipt"), "AccountMergeReceipt.absorbedPunkId"),
      accountRevisions: AccountMergeReceiptAccountRevisions.fromJson(_asMap(_requiredKey(json, "accountRevisions", "AccountMergeReceipt"), "AccountMergeReceipt.accountRevisions")),
      committedAt: _asString(_requiredKey(json, "committedAt", "AccountMergeReceipt"), "AccountMergeReceipt.committedAt"),
      receiptHash: _asString(_requiredKey(json, "receiptHash", "AccountMergeReceipt"), "AccountMergeReceipt.receiptHash"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "schemaVersion": schemaVersion,
      "receiptId": receiptId,
      "intentId": intentId,
      "planId": planId,
      "planDigest": planDigest,
      "commitCommandId": commitCommandId,
      "survivorPunkId": survivorPunkId,
      "absorbedPunkId": absorbedPunkId,
      "accountRevisions": accountRevisions.toJson(),
      "committedAt": committedAt,
      "receiptHash": receiptHash,
    };
    return json;
  }
}

enum AccountMergeStateStatus {
  planned("planned"),
  preparing("preparing"),
  committed("committed"),
  applying("applying"),
  completed("completed"),
  ;

  const AccountMergeStateStatus(this.value);

  final String value;

  factory AccountMergeStateStatus.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergeStateStatus value');
  }

  String toJson() => value;
}

class AccountMergeStateAccountRevisions {
  final int survivor;
  final int absorbed;

  const AccountMergeStateAccountRevisions({
    required this.survivor,
    required this.absorbed,
  });

  factory AccountMergeStateAccountRevisions.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"survivor", "absorbed"}, "AccountMergeStateAccountRevisions");
    return AccountMergeStateAccountRevisions(
      survivor: _asInt(_requiredKey(json, "survivor", "AccountMergeStateAccountRevisions"), "AccountMergeStateAccountRevisions.survivor"),
      absorbed: _asInt(_requiredKey(json, "absorbed", "AccountMergeStateAccountRevisions"), "AccountMergeStateAccountRevisions.absorbed"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "survivor": survivor,
      "absorbed": absorbed,
    };
    return json;
  }
}

class AccountMergeStateReceipt {
  final String contract;
  final int schemaVersion;
  final String receiptId;
  final String intentId;
  final String planId;
  final String planDigest;
  final String commitCommandId;
  final String survivorPunkId;
  final String absorbedPunkId;
  final AccountMergeStateAccountRevisions accountRevisions;
  final String committedAt;
  final String receiptHash;

  const AccountMergeStateReceipt({
    required this.contract,
    required this.schemaVersion,
    required this.receiptId,
    required this.intentId,
    required this.planId,
    required this.planDigest,
    required this.commitCommandId,
    required this.survivorPunkId,
    required this.absorbedPunkId,
    required this.accountRevisions,
    required this.committedAt,
    required this.receiptHash,
  });

  factory AccountMergeStateReceipt.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "schemaVersion", "receiptId", "intentId", "planId", "planDigest", "commitCommandId", "survivorPunkId", "absorbedPunkId", "accountRevisions", "committedAt", "receiptHash"}, "AccountMergeStateReceipt");
    return AccountMergeStateReceipt(
      contract: _expectStringConst(_requiredKey(json, "contract", "AccountMergeStateReceipt"), "account-merge.receipt@1", "AccountMergeStateReceipt.contract"),
      schemaVersion: _expectIntConst(_requiredKey(json, "schemaVersion", "AccountMergeStateReceipt"), 1, "AccountMergeStateReceipt.schemaVersion"),
      receiptId: _asString(_requiredKey(json, "receiptId", "AccountMergeStateReceipt"), "AccountMergeStateReceipt.receiptId"),
      intentId: _asString(_requiredKey(json, "intentId", "AccountMergeStateReceipt"), "AccountMergeStateReceipt.intentId"),
      planId: _asString(_requiredKey(json, "planId", "AccountMergeStateReceipt"), "AccountMergeStateReceipt.planId"),
      planDigest: _asString(_requiredKey(json, "planDigest", "AccountMergeStateReceipt"), "AccountMergeStateReceipt.planDigest"),
      commitCommandId: _asString(_requiredKey(json, "commitCommandId", "AccountMergeStateReceipt"), "AccountMergeStateReceipt.commitCommandId"),
      survivorPunkId: _asString(_requiredKey(json, "survivorPunkId", "AccountMergeStateReceipt"), "AccountMergeStateReceipt.survivorPunkId"),
      absorbedPunkId: _asString(_requiredKey(json, "absorbedPunkId", "AccountMergeStateReceipt"), "AccountMergeStateReceipt.absorbedPunkId"),
      accountRevisions: AccountMergeStateAccountRevisions.fromJson(_asMap(_requiredKey(json, "accountRevisions", "AccountMergeStateReceipt"), "AccountMergeStateReceipt.accountRevisions")),
      committedAt: _asString(_requiredKey(json, "committedAt", "AccountMergeStateReceipt"), "AccountMergeStateReceipt.committedAt"),
      receiptHash: _asString(_requiredKey(json, "receiptHash", "AccountMergeStateReceipt"), "AccountMergeStateReceipt.receiptHash"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "schemaVersion": schemaVersion,
      "receiptId": receiptId,
      "intentId": intentId,
      "planId": planId,
      "planDigest": planDigest,
      "commitCommandId": commitCommandId,
      "survivorPunkId": survivorPunkId,
      "absorbedPunkId": absorbedPunkId,
      "accountRevisions": accountRevisions.toJson(),
      "committedAt": committedAt,
      "receiptHash": receiptHash,
    };
    return json;
  }
}

enum AccountMergeStateFailureCode {
  planExpired("plan_expired"),
  revisionConflict("revision_conflict"),
  blockingConflict("blocking_conflict"),
  authorityUnavailable("authority_unavailable"),
  idempotencyConflict("idempotency_conflict"),
  receiptConflict("receipt_conflict"),
  applicationPending("application_pending"),
  ;

  const AccountMergeStateFailureCode(this.value);

  final String value;

  factory AccountMergeStateFailureCode.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergeStateFailureCode value');
  }

  String toJson() => value;
}

class AccountMergeStateFailure {
  final AccountMergeStateFailureCode code;
  final String correlationId;
  final String recordedAt;

  const AccountMergeStateFailure({
    required this.code,
    required this.correlationId,
    required this.recordedAt,
  });

  factory AccountMergeStateFailure.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"code", "correlationId", "recordedAt"}, "AccountMergeStateFailure");
    return AccountMergeStateFailure(
      code: AccountMergeStateFailureCode.fromJson(_requiredKey(json, "code", "AccountMergeStateFailure"), "AccountMergeStateFailure.code"),
      correlationId: _asString(_requiredKey(json, "correlationId", "AccountMergeStateFailure"), "AccountMergeStateFailure.correlationId"),
      recordedAt: _asString(_requiredKey(json, "recordedAt", "AccountMergeStateFailure"), "AccountMergeStateFailure.recordedAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "code": code.toJson(),
      "correlationId": correlationId,
      "recordedAt": recordedAt,
    };
    return json;
  }
}

class AccountMergeState {
  final String contract;
  final int schemaVersion;
  final String intentId;
  final String planId;
  final String planDigest;
  final AccountMergeStateStatus status;
  final String survivorPunkId;
  final String absorbedPunkId;
  final int applicationCursor;
  final int applicationTotal;
  final AccountMergeStateReceipt? receipt;
  final AccountMergeStateFailure? lastFailure;
  final String? committedAt;
  final String? completedAt;
  final String updatedAt;

  const AccountMergeState({
    required this.contract,
    required this.schemaVersion,
    required this.intentId,
    required this.planId,
    required this.planDigest,
    required this.status,
    required this.survivorPunkId,
    required this.absorbedPunkId,
    required this.applicationCursor,
    required this.applicationTotal,
    required this.receipt,
    required this.lastFailure,
    required this.committedAt,
    required this.completedAt,
    required this.updatedAt,
  });

  factory AccountMergeState.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "schemaVersion", "intentId", "planId", "planDigest", "status", "survivorPunkId", "absorbedPunkId", "applicationCursor", "applicationTotal", "receipt", "lastFailure", "committedAt", "completedAt", "updatedAt"}, "AccountMergeState");
    if (!((((_hasKey(json, "status") && (!_hasKey(json, "status") || (const <Object?>["planned", "preparing"].contains(_valueAt(json, "status"))))) ? ((!_hasKey(json, "receipt") || ((_valueAt(json, "receipt") == null))) && (!_hasKey(json, "committedAt") || ((_valueAt(json, "committedAt") == null))) && (!_hasKey(json, "completedAt") || ((_valueAt(json, "completedAt") == null)))) : (true))) && (((_hasKey(json, "status") && (!_hasKey(json, "status") || (const <Object?>["committed", "applying"].contains(_valueAt(json, "status"))))) ? ((!_hasKey(json, "receipt") || ((_valueAt(json, "receipt") is Map<String, Object?>) && _hasKey(_valueAt(json, "receipt"), "contract") && _hasKey(_valueAt(json, "receipt"), "schemaVersion") && _hasKey(_valueAt(json, "receipt"), "receiptId") && _hasKey(_valueAt(json, "receipt"), "intentId") && _hasKey(_valueAt(json, "receipt"), "planId") && _hasKey(_valueAt(json, "receipt"), "planDigest") && _hasKey(_valueAt(json, "receipt"), "commitCommandId") && _hasKey(_valueAt(json, "receipt"), "survivorPunkId") && _hasKey(_valueAt(json, "receipt"), "absorbedPunkId") && _hasKey(_valueAt(json, "receipt"), "accountRevisions") && _hasKey(_valueAt(json, "receipt"), "committedAt") && _hasKey(_valueAt(json, "receipt"), "receiptHash") && (!_hasKey(_valueAt(json, "receipt"), "contract") || (_valueAt(_valueAt(json, "receipt"), "contract") == "account-merge.receipt@1")) && (!_hasKey(_valueAt(json, "receipt"), "schemaVersion") || (_valueAt(_valueAt(json, "receipt"), "schemaVersion") == 1)) && (!_hasKey(_valueAt(json, "receipt"), "receiptId") || ((_valueAt(_valueAt(json, "receipt"), "receiptId") is String))) && (!_hasKey(_valueAt(json, "receipt"), "intentId") || ((_valueAt(_valueAt(json, "receipt"), "intentId") is String))) && (!_hasKey(_valueAt(json, "receipt"), "planId") || ((_valueAt(_valueAt(json, "receipt"), "planId") is String))) && (!_hasKey(_valueAt(json, "receipt"), "planDigest") || ((_valueAt(_valueAt(json, "receipt"), "planDigest") is String))) && (!_hasKey(_valueAt(json, "receipt"), "commitCommandId") || ((_valueAt(_valueAt(json, "receipt"), "commitCommandId") is String))) && (!_hasKey(_valueAt(json, "receipt"), "survivorPunkId") || ((_valueAt(_valueAt(json, "receipt"), "survivorPunkId") is String))) && (!_hasKey(_valueAt(json, "receipt"), "absorbedPunkId") || ((_valueAt(_valueAt(json, "receipt"), "absorbedPunkId") is String))) && (!_hasKey(_valueAt(json, "receipt"), "accountRevisions") || ((_valueAt(_valueAt(json, "receipt"), "accountRevisions") is Map<String, Object?>) && _hasKey(_valueAt(_valueAt(json, "receipt"), "accountRevisions"), "survivor") && _hasKey(_valueAt(_valueAt(json, "receipt"), "accountRevisions"), "absorbed") && (!_hasKey(_valueAt(_valueAt(json, "receipt"), "accountRevisions"), "survivor") || ((_valueAt(_valueAt(_valueAt(json, "receipt"), "accountRevisions"), "survivor") is int))) && (!_hasKey(_valueAt(_valueAt(json, "receipt"), "accountRevisions"), "absorbed") || ((_valueAt(_valueAt(_valueAt(json, "receipt"), "accountRevisions"), "absorbed") is int))))) && (!_hasKey(_valueAt(json, "receipt"), "committedAt") || ((_valueAt(_valueAt(json, "receipt"), "committedAt") is String))) && (!_hasKey(_valueAt(json, "receipt"), "receiptHash") || ((_valueAt(_valueAt(json, "receipt"), "receiptHash") is String))))) && (!_hasKey(json, "committedAt") || ((_valueAt(json, "committedAt") is String))) && (!_hasKey(json, "completedAt") || ((_valueAt(json, "completedAt") == null)))) : (true))) && (((_hasKey(json, "status") && (!_hasKey(json, "status") || (_valueAt(json, "status") == "completed"))) ? ((!_hasKey(json, "receipt") || ((_valueAt(json, "receipt") is Map<String, Object?>) && _hasKey(_valueAt(json, "receipt"), "contract") && _hasKey(_valueAt(json, "receipt"), "schemaVersion") && _hasKey(_valueAt(json, "receipt"), "receiptId") && _hasKey(_valueAt(json, "receipt"), "intentId") && _hasKey(_valueAt(json, "receipt"), "planId") && _hasKey(_valueAt(json, "receipt"), "planDigest") && _hasKey(_valueAt(json, "receipt"), "commitCommandId") && _hasKey(_valueAt(json, "receipt"), "survivorPunkId") && _hasKey(_valueAt(json, "receipt"), "absorbedPunkId") && _hasKey(_valueAt(json, "receipt"), "accountRevisions") && _hasKey(_valueAt(json, "receipt"), "committedAt") && _hasKey(_valueAt(json, "receipt"), "receiptHash") && (!_hasKey(_valueAt(json, "receipt"), "contract") || (_valueAt(_valueAt(json, "receipt"), "contract") == "account-merge.receipt@1")) && (!_hasKey(_valueAt(json, "receipt"), "schemaVersion") || (_valueAt(_valueAt(json, "receipt"), "schemaVersion") == 1)) && (!_hasKey(_valueAt(json, "receipt"), "receiptId") || ((_valueAt(_valueAt(json, "receipt"), "receiptId") is String))) && (!_hasKey(_valueAt(json, "receipt"), "intentId") || ((_valueAt(_valueAt(json, "receipt"), "intentId") is String))) && (!_hasKey(_valueAt(json, "receipt"), "planId") || ((_valueAt(_valueAt(json, "receipt"), "planId") is String))) && (!_hasKey(_valueAt(json, "receipt"), "planDigest") || ((_valueAt(_valueAt(json, "receipt"), "planDigest") is String))) && (!_hasKey(_valueAt(json, "receipt"), "commitCommandId") || ((_valueAt(_valueAt(json, "receipt"), "commitCommandId") is String))) && (!_hasKey(_valueAt(json, "receipt"), "survivorPunkId") || ((_valueAt(_valueAt(json, "receipt"), "survivorPunkId") is String))) && (!_hasKey(_valueAt(json, "receipt"), "absorbedPunkId") || ((_valueAt(_valueAt(json, "receipt"), "absorbedPunkId") is String))) && (!_hasKey(_valueAt(json, "receipt"), "accountRevisions") || ((_valueAt(_valueAt(json, "receipt"), "accountRevisions") is Map<String, Object?>) && _hasKey(_valueAt(_valueAt(json, "receipt"), "accountRevisions"), "survivor") && _hasKey(_valueAt(_valueAt(json, "receipt"), "accountRevisions"), "absorbed") && (!_hasKey(_valueAt(_valueAt(json, "receipt"), "accountRevisions"), "survivor") || ((_valueAt(_valueAt(_valueAt(json, "receipt"), "accountRevisions"), "survivor") is int))) && (!_hasKey(_valueAt(_valueAt(json, "receipt"), "accountRevisions"), "absorbed") || ((_valueAt(_valueAt(_valueAt(json, "receipt"), "accountRevisions"), "absorbed") is int))))) && (!_hasKey(_valueAt(json, "receipt"), "committedAt") || ((_valueAt(_valueAt(json, "receipt"), "committedAt") is String))) && (!_hasKey(_valueAt(json, "receipt"), "receiptHash") || ((_valueAt(_valueAt(json, "receipt"), "receiptHash") is String))))) && (!_hasKey(json, "committedAt") || ((_valueAt(json, "committedAt") is String))) && (!_hasKey(json, "completedAt") || ((_valueAt(json, "completedAt") is String)))) : (true))))) {
      throw FormatException("AccountMergeState violates its structural alternatives");
    }
    return AccountMergeState(
      contract: _expectStringConst(_requiredKey(json, "contract", "AccountMergeState"), "account-merge.state@1", "AccountMergeState.contract"),
      schemaVersion: _expectIntConst(_requiredKey(json, "schemaVersion", "AccountMergeState"), 1, "AccountMergeState.schemaVersion"),
      intentId: _asString(_requiredKey(json, "intentId", "AccountMergeState"), "AccountMergeState.intentId"),
      planId: _asString(_requiredKey(json, "planId", "AccountMergeState"), "AccountMergeState.planId"),
      planDigest: _asString(_requiredKey(json, "planDigest", "AccountMergeState"), "AccountMergeState.planDigest"),
      status: AccountMergeStateStatus.fromJson(_requiredKey(json, "status", "AccountMergeState"), "AccountMergeState.status"),
      survivorPunkId: _asString(_requiredKey(json, "survivorPunkId", "AccountMergeState"), "AccountMergeState.survivorPunkId"),
      absorbedPunkId: _asString(_requiredKey(json, "absorbedPunkId", "AccountMergeState"), "AccountMergeState.absorbedPunkId"),
      applicationCursor: _asInt(_requiredKey(json, "applicationCursor", "AccountMergeState"), "AccountMergeState.applicationCursor"),
      applicationTotal: _asInt(_requiredKey(json, "applicationTotal", "AccountMergeState"), "AccountMergeState.applicationTotal"),
      receipt: _requiredKey(json, "receipt", "AccountMergeState") == null ? null : AccountMergeStateReceipt.fromJson(_asMap(_requiredKey(json, "receipt", "AccountMergeState"), "AccountMergeState.receipt")),
      lastFailure: _requiredKey(json, "lastFailure", "AccountMergeState") == null ? null : AccountMergeStateFailure.fromJson(_asMap(_requiredKey(json, "lastFailure", "AccountMergeState"), "AccountMergeState.lastFailure")),
      committedAt: _requiredKey(json, "committedAt", "AccountMergeState") == null ? null : _asString(_requiredKey(json, "committedAt", "AccountMergeState"), "AccountMergeState.committedAt"),
      completedAt: _requiredKey(json, "completedAt", "AccountMergeState") == null ? null : _asString(_requiredKey(json, "completedAt", "AccountMergeState"), "AccountMergeState.completedAt"),
      updatedAt: _asString(_requiredKey(json, "updatedAt", "AccountMergeState"), "AccountMergeState.updatedAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "schemaVersion": schemaVersion,
      "intentId": intentId,
      "planId": planId,
      "planDigest": planDigest,
      "status": status.toJson(),
      "survivorPunkId": survivorPunkId,
      "absorbedPunkId": absorbedPunkId,
      "applicationCursor": applicationCursor,
      "applicationTotal": applicationTotal,
      "receipt": receipt == null ? null : receipt!.toJson(),
      "lastFailure": lastFailure == null ? null : lastFailure!.toJson(),
      "committedAt": committedAt == null ? null : committedAt!,
      "completedAt": completedAt == null ? null : completedAt!,
      "updatedAt": updatedAt,
    };
    return json;
  }
}

class AccountMergeCommitResponseTrue extends AccountMergeCommitResponse {
  final String contract;
  final bool ok;
  final AccountMergeState state;
  final bool replayed;

  const AccountMergeCommitResponseTrue({
    required this.contract,
    required this.ok,
    required this.state,
    required this.replayed,
  }) : super();

  factory AccountMergeCommitResponseTrue.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "ok", "state", "replayed"}, "AccountMergeCommitResponseTrue");
    return AccountMergeCommitResponseTrue(
      contract: _expectStringConst(_requiredKey(json, "contract", "AccountMergeCommitResponseTrue"), "account-merge.commit-response@1", "AccountMergeCommitResponseTrue.contract"),
      ok: _expectBoolConst(_requiredKey(json, "ok", "AccountMergeCommitResponseTrue"), true, "AccountMergeCommitResponseTrue.ok"),
      state: AccountMergeState.fromJson(_asMap(_requiredKey(json, "state", "AccountMergeCommitResponseTrue"), "AccountMergeCommitResponseTrue.state")),
      replayed: _asBool(_requiredKey(json, "replayed", "AccountMergeCommitResponseTrue"), "AccountMergeCommitResponseTrue.replayed"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "ok": ok,
      "state": state.toJson(),
      "replayed": replayed,
    };
    return json;
  }
}

enum AccountMergeCommitResponseFalseCode {
  invalidRequest("invalid_request"),
  planUnavailable("plan_unavailable"),
  planExpired("plan_expired"),
  revisionConflict("revision_conflict"),
  blockingConflict("blocking_conflict"),
  authorityUnavailable("authority_unavailable"),
  idempotencyConflict("idempotency_conflict"),
  receiptConflict("receipt_conflict"),
  ;

  const AccountMergeCommitResponseFalseCode(this.value);

  final String value;

  factory AccountMergeCommitResponseFalseCode.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a AccountMergeCommitResponseFalseCode value');
  }

  String toJson() => value;
}

class AccountMergeCommitResponseFalse extends AccountMergeCommitResponse {
  final String contract;
  final bool ok;
  final AccountMergeCommitResponseFalseCode code;
  final String correlationId;

  const AccountMergeCommitResponseFalse({
    required this.contract,
    required this.ok,
    required this.code,
    required this.correlationId,
  }) : super();

  factory AccountMergeCommitResponseFalse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "ok", "code", "correlationId"}, "AccountMergeCommitResponseFalse");
    return AccountMergeCommitResponseFalse(
      contract: _expectStringConst(_requiredKey(json, "contract", "AccountMergeCommitResponseFalse"), "account-merge.commit-response@1", "AccountMergeCommitResponseFalse.contract"),
      ok: _expectBoolConst(_requiredKey(json, "ok", "AccountMergeCommitResponseFalse"), false, "AccountMergeCommitResponseFalse.ok"),
      code: AccountMergeCommitResponseFalseCode.fromJson(_requiredKey(json, "code", "AccountMergeCommitResponseFalse"), "AccountMergeCommitResponseFalse.code"),
      correlationId: _asString(_requiredKey(json, "correlationId", "AccountMergeCommitResponseFalse"), "AccountMergeCommitResponseFalse.correlationId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "ok": ok,
      "code": code.toJson(),
      "correlationId": correlationId,
    };
    return json;
  }
}

sealed class AccountMergeCommitResponse {
  const AccountMergeCommitResponse();

  factory AccountMergeCommitResponse.fromJson(Map<String, Object?> json) {
    switch (json["ok"]) {
      case true:
        return AccountMergeCommitResponseTrue.fromJson(json);
      case false:
        return AccountMergeCommitResponseFalse.fromJson(json);
      default:
        throw FormatException('AccountMergeCommitResponse.ok has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class SetWorkspaceMemberRoleCommandActor {
  final String kind;
  final String punkId;

  const SetWorkspaceMemberRoleCommandActor({
    required this.kind,
    required this.punkId,
  });

  factory SetWorkspaceMemberRoleCommandActor.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "SetWorkspaceMemberRoleCommandActor");
    return SetWorkspaceMemberRoleCommandActor(
      kind: _expectStringConst(_requiredKey(json, "kind", "SetWorkspaceMemberRoleCommandActor"), "punk", "SetWorkspaceMemberRoleCommandActor.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "SetWorkspaceMemberRoleCommandActor"), "SetWorkspaceMemberRoleCommandActor.punkId"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

enum SetWorkspaceMemberRoleCommandPayloadRole {
  owner("owner"),
  moderator("moderator"),
  member("member"),
  guest("guest"),
  ;

  const SetWorkspaceMemberRoleCommandPayloadRole(this.value);

  final String value;

  factory SetWorkspaceMemberRoleCommandPayloadRole.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a SetWorkspaceMemberRoleCommandPayloadRole value');
  }

  String toJson() => value;
}

class SetWorkspaceMemberRoleCommandPayload {
  final String targetPunkId;
  final SetWorkspaceMemberRoleCommandPayloadRole role;
  final int expectedRevision;

  const SetWorkspaceMemberRoleCommandPayload({
    required this.targetPunkId,
    required this.role,
    required this.expectedRevision,
  });

  factory SetWorkspaceMemberRoleCommandPayload.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"targetPunkId", "role", "expectedRevision"}, "SetWorkspaceMemberRoleCommandPayload");
    return SetWorkspaceMemberRoleCommandPayload(
      targetPunkId: _asString(_requiredKey(json, "targetPunkId", "SetWorkspaceMemberRoleCommandPayload"), "SetWorkspaceMemberRoleCommandPayload.targetPunkId"),
      role: SetWorkspaceMemberRoleCommandPayloadRole.fromJson(_requiredKey(json, "role", "SetWorkspaceMemberRoleCommandPayload"), "SetWorkspaceMemberRoleCommandPayload.role"),
      expectedRevision: _asInt(_requiredKey(json, "expectedRevision", "SetWorkspaceMemberRoleCommandPayload"), "SetWorkspaceMemberRoleCommandPayload.expectedRevision"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "targetPunkId": targetPunkId,
      "role": role.toJson(),
      "expectedRevision": expectedRevision,
    };
    return json;
  }
}

class SetWorkspaceMemberRoleCommand {
  final String contract;
  final String commandId;
  final String workspaceId;
  final SetWorkspaceMemberRoleCommandActor actor;
  final SetWorkspaceMemberRoleCommandPayload payload;

  const SetWorkspaceMemberRoleCommand({
    required this.contract,
    required this.commandId,
    required this.workspaceId,
    required this.actor,
    required this.payload,
  });

  factory SetWorkspaceMemberRoleCommand.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "commandId", "workspaceId", "actor", "payload"}, "SetWorkspaceMemberRoleCommand");
    return SetWorkspaceMemberRoleCommand(
      contract: _expectStringConst(_requiredKey(json, "contract", "SetWorkspaceMemberRoleCommand"), "workspace.member-set-role@1", "SetWorkspaceMemberRoleCommand.contract"),
      commandId: _asString(_requiredKey(json, "commandId", "SetWorkspaceMemberRoleCommand"), "SetWorkspaceMemberRoleCommand.commandId"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "SetWorkspaceMemberRoleCommand"), "SetWorkspaceMemberRoleCommand.workspaceId"),
      actor: SetWorkspaceMemberRoleCommandActor.fromJson(_asMap(_requiredKey(json, "actor", "SetWorkspaceMemberRoleCommand"), "SetWorkspaceMemberRoleCommand.actor")),
      payload: SetWorkspaceMemberRoleCommandPayload.fromJson(_asMap(_requiredKey(json, "payload", "SetWorkspaceMemberRoleCommand"), "SetWorkspaceMemberRoleCommand.payload")),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "commandId": commandId,
      "workspaceId": workspaceId,
      "actor": actor.toJson(),
      "payload": payload.toJson(),
    };
    return json;
  }
}

class GetWorkspaceGovernanceQuery {
  final String contract;
  final String workspaceId;
  final int limit;
  final String? cursor;

  const GetWorkspaceGovernanceQuery({
    required this.contract,
    required this.workspaceId,
    required this.limit,
    required this.cursor,
  });

  factory GetWorkspaceGovernanceQuery.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspaceId", "limit", "cursor"}, "GetWorkspaceGovernanceQuery");
    return GetWorkspaceGovernanceQuery(
      contract: _expectStringConst(_requiredKey(json, "contract", "GetWorkspaceGovernanceQuery"), "workspace.governance@1", "GetWorkspaceGovernanceQuery.contract"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "GetWorkspaceGovernanceQuery"), "GetWorkspaceGovernanceQuery.workspaceId"),
      limit: _asInt(_requiredKey(json, "limit", "GetWorkspaceGovernanceQuery"), "GetWorkspaceGovernanceQuery.limit"),
      cursor: _requiredKey(json, "cursor", "GetWorkspaceGovernanceQuery") == null ? null : _asString(_requiredKey(json, "cursor", "GetWorkspaceGovernanceQuery"), "GetWorkspaceGovernanceQuery.cursor"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspaceId": workspaceId,
      "limit": limit,
      "cursor": cursor == null ? null : cursor!,
    };
    return json;
  }
}

enum WorkspaceGovernanceViewVisibility {
  private("private"),
  punks("punks"),
  public("public"),
  ;

  const WorkspaceGovernanceViewVisibility(this.value);

  final String value;

  factory WorkspaceGovernanceViewVisibility.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a WorkspaceGovernanceViewVisibility value');
  }

  String toJson() => value;
}

class WorkspaceGovernanceView {
  final String contract;
  final String id;
  final String slug;
  final String name;
  final WorkspaceGovernanceViewVisibility visibility;
  final String status;
  final String ownerPunkId;
  final int memberCount;
  final int revision;
  final int cursor;
  final String createdAt;
  final String updatedAt;

  const WorkspaceGovernanceView({
    required this.contract,
    required this.id,
    required this.slug,
    required this.name,
    required this.visibility,
    required this.status,
    required this.ownerPunkId,
    required this.memberCount,
    required this.revision,
    required this.cursor,
    required this.createdAt,
    required this.updatedAt,
  });

  factory WorkspaceGovernanceView.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "id", "slug", "name", "visibility", "status", "ownerPunkId", "memberCount", "revision", "cursor", "createdAt", "updatedAt"}, "WorkspaceGovernanceView");
    return WorkspaceGovernanceView(
      contract: _expectStringConst(_requiredKey(json, "contract", "WorkspaceGovernanceView"), "workspace.governance-view@1", "WorkspaceGovernanceView.contract"),
      id: _asString(_requiredKey(json, "id", "WorkspaceGovernanceView"), "WorkspaceGovernanceView.id"),
      slug: _asString(_requiredKey(json, "slug", "WorkspaceGovernanceView"), "WorkspaceGovernanceView.slug"),
      name: _asString(_requiredKey(json, "name", "WorkspaceGovernanceView"), "WorkspaceGovernanceView.name"),
      visibility: WorkspaceGovernanceViewVisibility.fromJson(_requiredKey(json, "visibility", "WorkspaceGovernanceView"), "WorkspaceGovernanceView.visibility"),
      status: _expectStringConst(_requiredKey(json, "status", "WorkspaceGovernanceView"), "active", "WorkspaceGovernanceView.status"),
      ownerPunkId: _asString(_requiredKey(json, "ownerPunkId", "WorkspaceGovernanceView"), "WorkspaceGovernanceView.ownerPunkId"),
      memberCount: _asInt(_requiredKey(json, "memberCount", "WorkspaceGovernanceView"), "WorkspaceGovernanceView.memberCount"),
      revision: _asInt(_requiredKey(json, "revision", "WorkspaceGovernanceView"), "WorkspaceGovernanceView.revision"),
      cursor: _asInt(_requiredKey(json, "cursor", "WorkspaceGovernanceView"), "WorkspaceGovernanceView.cursor"),
      createdAt: _asString(_requiredKey(json, "createdAt", "WorkspaceGovernanceView"), "WorkspaceGovernanceView.createdAt"),
      updatedAt: _asString(_requiredKey(json, "updatedAt", "WorkspaceGovernanceView"), "WorkspaceGovernanceView.updatedAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "id": id,
      "slug": slug,
      "name": name,
      "visibility": visibility.toJson(),
      "status": status,
      "ownerPunkId": ownerPunkId,
      "memberCount": memberCount,
      "revision": revision,
      "cursor": cursor,
      "createdAt": createdAt,
      "updatedAt": updatedAt,
    };
    return json;
  }
}

enum WorkspaceGovernanceResponseMemberRole {
  owner("owner"),
  moderator("moderator"),
  member("member"),
  guest("guest"),
  ;

  const WorkspaceGovernanceResponseMemberRole(this.value);

  final String value;

  factory WorkspaceGovernanceResponseMemberRole.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a WorkspaceGovernanceResponseMemberRole value');
  }

  String toJson() => value;
}

class WorkspaceGovernanceResponseMember {
  final String punkId;
  final WorkspaceGovernanceResponseMemberRole role;

  const WorkspaceGovernanceResponseMember({
    required this.punkId,
    required this.role,
  });

  factory WorkspaceGovernanceResponseMember.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"punkId", "role"}, "WorkspaceGovernanceResponseMember");
    return WorkspaceGovernanceResponseMember(
      punkId: _asString(_requiredKey(json, "punkId", "WorkspaceGovernanceResponseMember"), "WorkspaceGovernanceResponseMember.punkId"),
      role: WorkspaceGovernanceResponseMemberRole.fromJson(_requiredKey(json, "role", "WorkspaceGovernanceResponseMember"), "WorkspaceGovernanceResponseMember.role"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "punkId": punkId,
      "role": role.toJson(),
    };
    return json;
  }
}

class WorkspaceGovernanceResponse {
  final String contract;
  final WorkspaceGovernanceView workspace;
  final List<WorkspaceGovernanceResponseMember> members;
  final String? nextCursor;

  const WorkspaceGovernanceResponse({
    required this.contract,
    required this.workspace,
    required this.members,
    required this.nextCursor,
  });

  factory WorkspaceGovernanceResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspace", "members", "nextCursor"}, "WorkspaceGovernanceResponse");
    return WorkspaceGovernanceResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "WorkspaceGovernanceResponse"), "workspace.governance-response@1", "WorkspaceGovernanceResponse.contract"),
      workspace: WorkspaceGovernanceView.fromJson(_asMap(_requiredKey(json, "workspace", "WorkspaceGovernanceResponse"), "WorkspaceGovernanceResponse.workspace")),
      members: _asList(_requiredKey(json, "members", "WorkspaceGovernanceResponse"), "WorkspaceGovernanceResponse.members").map((item) => WorkspaceGovernanceResponseMember.fromJson(_asMap(item, "WorkspaceGovernanceResponse.members[]"))).toList(growable: false),
      nextCursor: _requiredKey(json, "nextCursor", "WorkspaceGovernanceResponse") == null ? null : _asString(_requiredKey(json, "nextCursor", "WorkspaceGovernanceResponse"), "WorkspaceGovernanceResponse.nextCursor"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspace": workspace.toJson(),
      "members": members.map((item) => item.toJson()).toList(growable: false),
      "nextCursor": nextCursor == null ? null : nextCursor!,
    };
    return json;
  }
}

class RemoveWorkspaceMemberCommandActor {
  final String kind;
  final String punkId;

  const RemoveWorkspaceMemberCommandActor({
    required this.kind,
    required this.punkId,
  });

  factory RemoveWorkspaceMemberCommandActor.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "RemoveWorkspaceMemberCommandActor");
    return RemoveWorkspaceMemberCommandActor(
      kind: _expectStringConst(_requiredKey(json, "kind", "RemoveWorkspaceMemberCommandActor"), "punk", "RemoveWorkspaceMemberCommandActor.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "RemoveWorkspaceMemberCommandActor"), "RemoveWorkspaceMemberCommandActor.punkId"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

class RemoveWorkspaceMemberCommandPayload {
  final String targetPunkId;
  final int expectedRevision;

  const RemoveWorkspaceMemberCommandPayload({
    required this.targetPunkId,
    required this.expectedRevision,
  });

  factory RemoveWorkspaceMemberCommandPayload.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"targetPunkId", "expectedRevision"}, "RemoveWorkspaceMemberCommandPayload");
    return RemoveWorkspaceMemberCommandPayload(
      targetPunkId: _asString(_requiredKey(json, "targetPunkId", "RemoveWorkspaceMemberCommandPayload"), "RemoveWorkspaceMemberCommandPayload.targetPunkId"),
      expectedRevision: _asInt(_requiredKey(json, "expectedRevision", "RemoveWorkspaceMemberCommandPayload"), "RemoveWorkspaceMemberCommandPayload.expectedRevision"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "targetPunkId": targetPunkId,
      "expectedRevision": expectedRevision,
    };
    return json;
  }
}

class RemoveWorkspaceMemberCommand {
  final String contract;
  final String commandId;
  final String workspaceId;
  final RemoveWorkspaceMemberCommandActor actor;
  final RemoveWorkspaceMemberCommandPayload payload;

  const RemoveWorkspaceMemberCommand({
    required this.contract,
    required this.commandId,
    required this.workspaceId,
    required this.actor,
    required this.payload,
  });

  factory RemoveWorkspaceMemberCommand.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "commandId", "workspaceId", "actor", "payload"}, "RemoveWorkspaceMemberCommand");
    return RemoveWorkspaceMemberCommand(
      contract: _expectStringConst(_requiredKey(json, "contract", "RemoveWorkspaceMemberCommand"), "workspace.member-remove@1", "RemoveWorkspaceMemberCommand.contract"),
      commandId: _asString(_requiredKey(json, "commandId", "RemoveWorkspaceMemberCommand"), "RemoveWorkspaceMemberCommand.commandId"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "RemoveWorkspaceMemberCommand"), "RemoveWorkspaceMemberCommand.workspaceId"),
      actor: RemoveWorkspaceMemberCommandActor.fromJson(_asMap(_requiredKey(json, "actor", "RemoveWorkspaceMemberCommand"), "RemoveWorkspaceMemberCommand.actor")),
      payload: RemoveWorkspaceMemberCommandPayload.fromJson(_asMap(_requiredKey(json, "payload", "RemoveWorkspaceMemberCommand"), "RemoveWorkspaceMemberCommand.payload")),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "commandId": commandId,
      "workspaceId": workspaceId,
      "actor": actor.toJson(),
      "payload": payload.toJson(),
    };
    return json;
  }
}

class LeaveWorkspaceCommandActor {
  final String kind;
  final String punkId;

  const LeaveWorkspaceCommandActor({
    required this.kind,
    required this.punkId,
  });

  factory LeaveWorkspaceCommandActor.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "LeaveWorkspaceCommandActor");
    return LeaveWorkspaceCommandActor(
      kind: _expectStringConst(_requiredKey(json, "kind", "LeaveWorkspaceCommandActor"), "punk", "LeaveWorkspaceCommandActor.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "LeaveWorkspaceCommandActor"), "LeaveWorkspaceCommandActor.punkId"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

class LeaveWorkspaceCommand {
  final String contract;
  final String commandId;
  final String workspaceId;
  final LeaveWorkspaceCommandActor actor;
  final Map<String, Object?> payload;

  const LeaveWorkspaceCommand({
    required this.contract,
    required this.commandId,
    required this.workspaceId,
    required this.actor,
    required this.payload,
  });

  factory LeaveWorkspaceCommand.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "commandId", "workspaceId", "actor", "payload"}, "LeaveWorkspaceCommand");
    return LeaveWorkspaceCommand(
      contract: _expectStringConst(_requiredKey(json, "contract", "LeaveWorkspaceCommand"), "workspace.leave@1", "LeaveWorkspaceCommand.contract"),
      commandId: _asString(_requiredKey(json, "commandId", "LeaveWorkspaceCommand"), "LeaveWorkspaceCommand.commandId"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "LeaveWorkspaceCommand"), "LeaveWorkspaceCommand.workspaceId"),
      actor: LeaveWorkspaceCommandActor.fromJson(_asMap(_requiredKey(json, "actor", "LeaveWorkspaceCommand"), "LeaveWorkspaceCommand.actor")),
      payload: _asMap(_requiredKey(json, "payload", "LeaveWorkspaceCommand"), "LeaveWorkspaceCommand.payload"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "commandId": commandId,
      "workspaceId": workspaceId,
      "actor": actor.toJson(),
      "payload": payload,
    };
    return json;
  }
}

class TransferWorkspaceOwnershipCommandActor {
  final String kind;
  final String punkId;

  const TransferWorkspaceOwnershipCommandActor({
    required this.kind,
    required this.punkId,
  });

  factory TransferWorkspaceOwnershipCommandActor.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "TransferWorkspaceOwnershipCommandActor");
    return TransferWorkspaceOwnershipCommandActor(
      kind: _expectStringConst(_requiredKey(json, "kind", "TransferWorkspaceOwnershipCommandActor"), "punk", "TransferWorkspaceOwnershipCommandActor.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "TransferWorkspaceOwnershipCommandActor"), "TransferWorkspaceOwnershipCommandActor.punkId"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

class TransferWorkspaceOwnershipCommandPayload {
  final String targetPunkId;
  final int expectedRevision;
  final String reauthorizationId;

  const TransferWorkspaceOwnershipCommandPayload({
    required this.targetPunkId,
    required this.expectedRevision,
    required this.reauthorizationId,
  });

  factory TransferWorkspaceOwnershipCommandPayload.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"targetPunkId", "expectedRevision", "reauthorizationId"}, "TransferWorkspaceOwnershipCommandPayload");
    return TransferWorkspaceOwnershipCommandPayload(
      targetPunkId: _asString(_requiredKey(json, "targetPunkId", "TransferWorkspaceOwnershipCommandPayload"), "TransferWorkspaceOwnershipCommandPayload.targetPunkId"),
      expectedRevision: _asInt(_requiredKey(json, "expectedRevision", "TransferWorkspaceOwnershipCommandPayload"), "TransferWorkspaceOwnershipCommandPayload.expectedRevision"),
      reauthorizationId: _asString(_requiredKey(json, "reauthorizationId", "TransferWorkspaceOwnershipCommandPayload"), "TransferWorkspaceOwnershipCommandPayload.reauthorizationId"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "targetPunkId": targetPunkId,
      "expectedRevision": expectedRevision,
      "reauthorizationId": reauthorizationId,
    };
    return json;
  }
}

class TransferWorkspaceOwnershipCommand {
  final String contract;
  final String commandId;
  final String workspaceId;
  final TransferWorkspaceOwnershipCommandActor actor;
  final TransferWorkspaceOwnershipCommandPayload payload;

  const TransferWorkspaceOwnershipCommand({
    required this.contract,
    required this.commandId,
    required this.workspaceId,
    required this.actor,
    required this.payload,
  });

  factory TransferWorkspaceOwnershipCommand.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "commandId", "workspaceId", "actor", "payload"}, "TransferWorkspaceOwnershipCommand");
    return TransferWorkspaceOwnershipCommand(
      contract: _expectStringConst(_requiredKey(json, "contract", "TransferWorkspaceOwnershipCommand"), "workspace.transfer-ownership@1", "TransferWorkspaceOwnershipCommand.contract"),
      commandId: _asString(_requiredKey(json, "commandId", "TransferWorkspaceOwnershipCommand"), "TransferWorkspaceOwnershipCommand.commandId"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "TransferWorkspaceOwnershipCommand"), "TransferWorkspaceOwnershipCommand.workspaceId"),
      actor: TransferWorkspaceOwnershipCommandActor.fromJson(_asMap(_requiredKey(json, "actor", "TransferWorkspaceOwnershipCommand"), "TransferWorkspaceOwnershipCommand.actor")),
      payload: TransferWorkspaceOwnershipCommandPayload.fromJson(_asMap(_requiredKey(json, "payload", "TransferWorkspaceOwnershipCommand"), "TransferWorkspaceOwnershipCommand.payload")),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "commandId": commandId,
      "workspaceId": workspaceId,
      "actor": actor.toJson(),
      "payload": payload.toJson(),
    };
    return json;
  }
}

enum WorkspaceMembershipMutationResponseMemberDeltasItemTrueRole {
  owner("owner"),
  moderator("moderator"),
  member("member"),
  guest("guest"),
  ;

  const WorkspaceMembershipMutationResponseMemberDeltasItemTrueRole(this.value);

  final String value;

  factory WorkspaceMembershipMutationResponseMemberDeltasItemTrueRole.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a WorkspaceMembershipMutationResponseMemberDeltasItemTrueRole value');
  }

  String toJson() => value;
}

class WorkspaceMembershipMutationResponseMemberDeltasItemTrue extends WorkspaceMembershipMutationResponseMemberDeltasItem {
  final String punkId;
  final bool present;
  final WorkspaceMembershipMutationResponseMemberDeltasItemTrueRole role;

  const WorkspaceMembershipMutationResponseMemberDeltasItemTrue({
    required this.punkId,
    required this.present,
    required this.role,
  }) : super();

  factory WorkspaceMembershipMutationResponseMemberDeltasItemTrue.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"punkId", "present", "role"}, "WorkspaceMembershipMutationResponseMemberDeltasItemTrue");
    return WorkspaceMembershipMutationResponseMemberDeltasItemTrue(
      punkId: _asString(_requiredKey(json, "punkId", "WorkspaceMembershipMutationResponseMemberDeltasItemTrue"), "WorkspaceMembershipMutationResponseMemberDeltasItemTrue.punkId"),
      present: _expectBoolConst(_requiredKey(json, "present", "WorkspaceMembershipMutationResponseMemberDeltasItemTrue"), true, "WorkspaceMembershipMutationResponseMemberDeltasItemTrue.present"),
      role: WorkspaceMembershipMutationResponseMemberDeltasItemTrueRole.fromJson(_requiredKey(json, "role", "WorkspaceMembershipMutationResponseMemberDeltasItemTrue"), "WorkspaceMembershipMutationResponseMemberDeltasItemTrue.role"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "punkId": punkId,
      "present": present,
      "role": role.toJson(),
    };
    return json;
  }
}

class WorkspaceMembershipMutationResponseMemberDeltasItemFalse extends WorkspaceMembershipMutationResponseMemberDeltasItem {
  final String punkId;
  final bool present;
  final Null role;

  const WorkspaceMembershipMutationResponseMemberDeltasItemFalse({
    required this.punkId,
    required this.present,
    required this.role,
  }) : super();

  factory WorkspaceMembershipMutationResponseMemberDeltasItemFalse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"punkId", "present", "role"}, "WorkspaceMembershipMutationResponseMemberDeltasItemFalse");
    return WorkspaceMembershipMutationResponseMemberDeltasItemFalse(
      punkId: _asString(_requiredKey(json, "punkId", "WorkspaceMembershipMutationResponseMemberDeltasItemFalse"), "WorkspaceMembershipMutationResponseMemberDeltasItemFalse.punkId"),
      present: _expectBoolConst(_requiredKey(json, "present", "WorkspaceMembershipMutationResponseMemberDeltasItemFalse"), false, "WorkspaceMembershipMutationResponseMemberDeltasItemFalse.present"),
      role: _expectNull(_requiredKey(json, "role", "WorkspaceMembershipMutationResponseMemberDeltasItemFalse"), "WorkspaceMembershipMutationResponseMemberDeltasItemFalse.role"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "punkId": punkId,
      "present": present,
      "role": role,
    };
    return json;
  }
}

sealed class WorkspaceMembershipMutationResponseMemberDeltasItem {
  const WorkspaceMembershipMutationResponseMemberDeltasItem();

  factory WorkspaceMembershipMutationResponseMemberDeltasItem.fromJson(Map<String, Object?> json) {
    switch (json["present"]) {
      case true:
        return WorkspaceMembershipMutationResponseMemberDeltasItemTrue.fromJson(json);
      case false:
        return WorkspaceMembershipMutationResponseMemberDeltasItemFalse.fromJson(json);
      default:
        throw FormatException('WorkspaceMembershipMutationResponseMemberDeltasItem.present has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class WorkspaceMembershipMutationResponse {
  final String contract;
  final WorkspaceGovernanceView workspace;
  final List<WorkspaceMembershipMutationResponseMemberDeltasItem> memberDeltas;
  final bool replayed;

  const WorkspaceMembershipMutationResponse({
    required this.contract,
    required this.workspace,
    required this.memberDeltas,
    required this.replayed,
  });

  factory WorkspaceMembershipMutationResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspace", "memberDeltas", "replayed"}, "WorkspaceMembershipMutationResponse");
    return WorkspaceMembershipMutationResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "WorkspaceMembershipMutationResponse"), "workspace.membership-mutation-response@1", "WorkspaceMembershipMutationResponse.contract"),
      workspace: WorkspaceGovernanceView.fromJson(_asMap(_requiredKey(json, "workspace", "WorkspaceMembershipMutationResponse"), "WorkspaceMembershipMutationResponse.workspace")),
      memberDeltas: _asList(_requiredKey(json, "memberDeltas", "WorkspaceMembershipMutationResponse"), "WorkspaceMembershipMutationResponse.memberDeltas").map((item) => WorkspaceMembershipMutationResponseMemberDeltasItem.fromJson(_asMap(item, "WorkspaceMembershipMutationResponse.memberDeltas[]"))).toList(growable: false),
      replayed: _asBool(_requiredKey(json, "replayed", "WorkspaceMembershipMutationResponse"), "WorkspaceMembershipMutationResponse.replayed"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspace": workspace.toJson(),
      "memberDeltas": memberDeltas.map((item) => item.toJson()).toList(growable: false),
      "replayed": replayed,
    };
    return json;
  }
}

enum WorkspaceMembershipLifecycleResponseOutcome {
  left("left"),
  ownershipTransferred("ownership_transferred"),
  ;

  const WorkspaceMembershipLifecycleResponseOutcome(this.value);

  final String value;

  factory WorkspaceMembershipLifecycleResponseOutcome.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a WorkspaceMembershipLifecycleResponseOutcome value');
  }

  String toJson() => value;
}

class WorkspaceMembershipLifecycleResponse {
  final String contract;
  final String workspaceId;
  final int revision;
  final WorkspaceMembershipLifecycleResponseOutcome outcome;
  final String? role;
  final bool replayed;

  const WorkspaceMembershipLifecycleResponse({
    required this.contract,
    required this.workspaceId,
    required this.revision,
    required this.outcome,
    required this.role,
    required this.replayed,
  });

  factory WorkspaceMembershipLifecycleResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspaceId", "revision", "outcome", "role", "replayed"}, "WorkspaceMembershipLifecycleResponse");
    return WorkspaceMembershipLifecycleResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "WorkspaceMembershipLifecycleResponse"), "workspace.membership-lifecycle-response@1", "WorkspaceMembershipLifecycleResponse.contract"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "WorkspaceMembershipLifecycleResponse"), "WorkspaceMembershipLifecycleResponse.workspaceId"),
      revision: _asInt(_requiredKey(json, "revision", "WorkspaceMembershipLifecycleResponse"), "WorkspaceMembershipLifecycleResponse.revision"),
      outcome: WorkspaceMembershipLifecycleResponseOutcome.fromJson(_requiredKey(json, "outcome", "WorkspaceMembershipLifecycleResponse"), "WorkspaceMembershipLifecycleResponse.outcome"),
      role: _requiredKey(json, "role", "WorkspaceMembershipLifecycleResponse") == null ? null : _expectStringConst(_requiredKey(json, "role", "WorkspaceMembershipLifecycleResponse"), "member", "WorkspaceMembershipLifecycleResponse.role"),
      replayed: _asBool(_requiredKey(json, "replayed", "WorkspaceMembershipLifecycleResponse"), "WorkspaceMembershipLifecycleResponse.replayed"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspaceId": workspaceId,
      "revision": revision,
      "outcome": outcome.toJson(),
      "role": role == null ? null : role!,
      "replayed": replayed,
    };
    return json;
  }
}

class WorkspaceInvitationViewWorkspace {
  final String id;
  final String slug;
  final String name;

  const WorkspaceInvitationViewWorkspace({
    required this.id,
    required this.slug,
    required this.name,
  });

  factory WorkspaceInvitationViewWorkspace.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"id", "slug", "name"}, "WorkspaceInvitationViewWorkspace");
    return WorkspaceInvitationViewWorkspace(
      id: _asString(_requiredKey(json, "id", "WorkspaceInvitationViewWorkspace"), "WorkspaceInvitationViewWorkspace.id"),
      slug: _asString(_requiredKey(json, "slug", "WorkspaceInvitationViewWorkspace"), "WorkspaceInvitationViewWorkspace.slug"),
      name: _asString(_requiredKey(json, "name", "WorkspaceInvitationViewWorkspace"), "WorkspaceInvitationViewWorkspace.name"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "id": id,
      "slug": slug,
      "name": name,
    };
    return json;
  }
}

enum WorkspaceInvitationViewRole {
  member("member"),
  guest("guest"),
  ;

  const WorkspaceInvitationViewRole(this.value);

  final String value;

  factory WorkspaceInvitationViewRole.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a WorkspaceInvitationViewRole value');
  }

  String toJson() => value;
}

enum WorkspaceInvitationViewStatus {
  issued("issued"),
  revoked("revoked"),
  expired("expired"),
  exhausted("exhausted"),
  ;

  const WorkspaceInvitationViewStatus(this.value);

  final String value;

  factory WorkspaceInvitationViewStatus.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a WorkspaceInvitationViewStatus value');
  }

  String toJson() => value;
}

class WorkspaceInvitationView {
  final String contract;
  final String invitationId;
  final WorkspaceInvitationViewWorkspace workspace;
  final int workspaceRevision;
  final WorkspaceInvitationViewRole role;
  final WorkspaceInvitationViewStatus status;
  final String issuedAt;
  final String expiresAt;
  final String? revokedAt;
  final int maxUses;
  final int uses;
  final int usesRemaining;

  const WorkspaceInvitationView({
    required this.contract,
    required this.invitationId,
    required this.workspace,
    required this.workspaceRevision,
    required this.role,
    required this.status,
    required this.issuedAt,
    required this.expiresAt,
    required this.revokedAt,
    required this.maxUses,
    required this.uses,
    required this.usesRemaining,
  });

  factory WorkspaceInvitationView.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "invitationId", "workspace", "workspaceRevision", "role", "status", "issuedAt", "expiresAt", "revokedAt", "maxUses", "uses", "usesRemaining"}, "WorkspaceInvitationView");
    return WorkspaceInvitationView(
      contract: _expectStringConst(_requiredKey(json, "contract", "WorkspaceInvitationView"), "workspace.invitation@1", "WorkspaceInvitationView.contract"),
      invitationId: _asString(_requiredKey(json, "invitationId", "WorkspaceInvitationView"), "WorkspaceInvitationView.invitationId"),
      workspace: WorkspaceInvitationViewWorkspace.fromJson(_asMap(_requiredKey(json, "workspace", "WorkspaceInvitationView"), "WorkspaceInvitationView.workspace")),
      workspaceRevision: _asInt(_requiredKey(json, "workspaceRevision", "WorkspaceInvitationView"), "WorkspaceInvitationView.workspaceRevision"),
      role: WorkspaceInvitationViewRole.fromJson(_requiredKey(json, "role", "WorkspaceInvitationView"), "WorkspaceInvitationView.role"),
      status: WorkspaceInvitationViewStatus.fromJson(_requiredKey(json, "status", "WorkspaceInvitationView"), "WorkspaceInvitationView.status"),
      issuedAt: _asString(_requiredKey(json, "issuedAt", "WorkspaceInvitationView"), "WorkspaceInvitationView.issuedAt"),
      expiresAt: _asString(_requiredKey(json, "expiresAt", "WorkspaceInvitationView"), "WorkspaceInvitationView.expiresAt"),
      revokedAt: _requiredKey(json, "revokedAt", "WorkspaceInvitationView") == null ? null : _asString(_requiredKey(json, "revokedAt", "WorkspaceInvitationView"), "WorkspaceInvitationView.revokedAt"),
      maxUses: _asInt(_requiredKey(json, "maxUses", "WorkspaceInvitationView"), "WorkspaceInvitationView.maxUses"),
      uses: _asInt(_requiredKey(json, "uses", "WorkspaceInvitationView"), "WorkspaceInvitationView.uses"),
      usesRemaining: _asInt(_requiredKey(json, "usesRemaining", "WorkspaceInvitationView"), "WorkspaceInvitationView.usesRemaining"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "invitationId": invitationId,
      "workspace": workspace.toJson(),
      "workspaceRevision": workspaceRevision,
      "role": role.toJson(),
      "status": status.toJson(),
      "issuedAt": issuedAt,
      "expiresAt": expiresAt,
      "revokedAt": revokedAt == null ? null : revokedAt!,
      "maxUses": maxUses,
      "uses": uses,
      "usesRemaining": usesRemaining,
    };
    return json;
  }
}

class CreateWorkspaceInvitationCommandActor {
  final String kind;
  final String punkId;

  const CreateWorkspaceInvitationCommandActor({
    required this.kind,
    required this.punkId,
  });

  factory CreateWorkspaceInvitationCommandActor.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "CreateWorkspaceInvitationCommandActor");
    return CreateWorkspaceInvitationCommandActor(
      kind: _expectStringConst(_requiredKey(json, "kind", "CreateWorkspaceInvitationCommandActor"), "punk", "CreateWorkspaceInvitationCommandActor.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "CreateWorkspaceInvitationCommandActor"), "CreateWorkspaceInvitationCommandActor.punkId"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

enum CreateWorkspaceInvitationCommandPayloadRole {
  member("member"),
  guest("guest"),
  ;

  const CreateWorkspaceInvitationCommandPayloadRole(this.value);

  final String value;

  factory CreateWorkspaceInvitationCommandPayloadRole.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a CreateWorkspaceInvitationCommandPayloadRole value');
  }

  String toJson() => value;
}

class CreateWorkspaceInvitationCommandPayload {
  final CreateWorkspaceInvitationCommandPayloadRole role;
  final int expectedRevision;
  final int? ttlSeconds;
  final int? maxUses;

  const CreateWorkspaceInvitationCommandPayload({
    required this.role,
    required this.expectedRevision,
    this.ttlSeconds,
    this.maxUses,
  });

  factory CreateWorkspaceInvitationCommandPayload.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"role", "expectedRevision", "ttlSeconds", "maxUses"}, "CreateWorkspaceInvitationCommandPayload");
    return CreateWorkspaceInvitationCommandPayload(
      role: CreateWorkspaceInvitationCommandPayloadRole.fromJson(_requiredKey(json, "role", "CreateWorkspaceInvitationCommandPayload"), "CreateWorkspaceInvitationCommandPayload.role"),
      expectedRevision: _asInt(_requiredKey(json, "expectedRevision", "CreateWorkspaceInvitationCommandPayload"), "CreateWorkspaceInvitationCommandPayload.expectedRevision"),
      ttlSeconds: json.containsKey("ttlSeconds") ? _asInt(json["ttlSeconds"], "CreateWorkspaceInvitationCommandPayload.ttlSeconds") : null,
      maxUses: json.containsKey("maxUses") ? _asInt(json["maxUses"], "CreateWorkspaceInvitationCommandPayload.maxUses") : null,
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "role": role.toJson(),
      "expectedRevision": expectedRevision,
    };
    if (ttlSeconds != null) {
      json["ttlSeconds"] = ttlSeconds!;
    }
    if (maxUses != null) {
      json["maxUses"] = maxUses!;
    }
    return json;
  }
}

class CreateWorkspaceInvitationCommand {
  final String contract;
  final String commandId;
  final String workspaceId;
  final CreateWorkspaceInvitationCommandActor actor;
  final CreateWorkspaceInvitationCommandPayload payload;

  const CreateWorkspaceInvitationCommand({
    required this.contract,
    required this.commandId,
    required this.workspaceId,
    required this.actor,
    required this.payload,
  });

  factory CreateWorkspaceInvitationCommand.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "commandId", "workspaceId", "actor", "payload"}, "CreateWorkspaceInvitationCommand");
    return CreateWorkspaceInvitationCommand(
      contract: _expectStringConst(_requiredKey(json, "contract", "CreateWorkspaceInvitationCommand"), "workspace.invite@1", "CreateWorkspaceInvitationCommand.contract"),
      commandId: _asString(_requiredKey(json, "commandId", "CreateWorkspaceInvitationCommand"), "CreateWorkspaceInvitationCommand.commandId"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "CreateWorkspaceInvitationCommand"), "CreateWorkspaceInvitationCommand.workspaceId"),
      actor: CreateWorkspaceInvitationCommandActor.fromJson(_asMap(_requiredKey(json, "actor", "CreateWorkspaceInvitationCommand"), "CreateWorkspaceInvitationCommand.actor")),
      payload: CreateWorkspaceInvitationCommandPayload.fromJson(_asMap(_requiredKey(json, "payload", "CreateWorkspaceInvitationCommand"), "CreateWorkspaceInvitationCommand.payload")),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "commandId": commandId,
      "workspaceId": workspaceId,
      "actor": actor.toJson(),
      "payload": payload.toJson(),
    };
    return json;
  }
}

class GetWorkspaceInvitationQuery {
  final String contract;
  final String code;

  const GetWorkspaceInvitationQuery({
    required this.contract,
    required this.code,
  });

  factory GetWorkspaceInvitationQuery.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "code"}, "GetWorkspaceInvitationQuery");
    return GetWorkspaceInvitationQuery(
      contract: _expectStringConst(_requiredKey(json, "contract", "GetWorkspaceInvitationQuery"), "workspace.invite-get@1", "GetWorkspaceInvitationQuery.contract"),
      code: _asString(_requiredKey(json, "code", "GetWorkspaceInvitationQuery"), "GetWorkspaceInvitationQuery.code"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "code": code,
    };
    return json;
  }
}

class CreateWorkspaceInvitationResponse {
  final String contract;
  final WorkspaceInvitationView invitation;
  final String code;
  final bool replayed;

  const CreateWorkspaceInvitationResponse({
    required this.contract,
    required this.invitation,
    required this.code,
    required this.replayed,
  });

  factory CreateWorkspaceInvitationResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "invitation", "code", "replayed"}, "CreateWorkspaceInvitationResponse");
    return CreateWorkspaceInvitationResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "CreateWorkspaceInvitationResponse"), "workspace.invite-response@1", "CreateWorkspaceInvitationResponse.contract"),
      invitation: WorkspaceInvitationView.fromJson(_asMap(_requiredKey(json, "invitation", "CreateWorkspaceInvitationResponse"), "CreateWorkspaceInvitationResponse.invitation")),
      code: _asString(_requiredKey(json, "code", "CreateWorkspaceInvitationResponse"), "CreateWorkspaceInvitationResponse.code"),
      replayed: _asBool(_requiredKey(json, "replayed", "CreateWorkspaceInvitationResponse"), "CreateWorkspaceInvitationResponse.replayed"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "invitation": invitation.toJson(),
      "code": code,
      "replayed": replayed,
    };
    return json;
  }
}

class RevokeWorkspaceInvitationCommandActor {
  final String kind;
  final String punkId;

  const RevokeWorkspaceInvitationCommandActor({
    required this.kind,
    required this.punkId,
  });

  factory RevokeWorkspaceInvitationCommandActor.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "RevokeWorkspaceInvitationCommandActor");
    return RevokeWorkspaceInvitationCommandActor(
      kind: _expectStringConst(_requiredKey(json, "kind", "RevokeWorkspaceInvitationCommandActor"), "punk", "RevokeWorkspaceInvitationCommandActor.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "RevokeWorkspaceInvitationCommandActor"), "RevokeWorkspaceInvitationCommandActor.punkId"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

class RevokeWorkspaceInvitationCommandPayload {
  final String invitationId;
  final int expectedRevision;

  const RevokeWorkspaceInvitationCommandPayload({
    required this.invitationId,
    required this.expectedRevision,
  });

  factory RevokeWorkspaceInvitationCommandPayload.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"invitationId", "expectedRevision"}, "RevokeWorkspaceInvitationCommandPayload");
    return RevokeWorkspaceInvitationCommandPayload(
      invitationId: _asString(_requiredKey(json, "invitationId", "RevokeWorkspaceInvitationCommandPayload"), "RevokeWorkspaceInvitationCommandPayload.invitationId"),
      expectedRevision: _asInt(_requiredKey(json, "expectedRevision", "RevokeWorkspaceInvitationCommandPayload"), "RevokeWorkspaceInvitationCommandPayload.expectedRevision"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "invitationId": invitationId,
      "expectedRevision": expectedRevision,
    };
    return json;
  }
}

class RevokeWorkspaceInvitationCommand {
  final String contract;
  final String commandId;
  final String workspaceId;
  final RevokeWorkspaceInvitationCommandActor actor;
  final RevokeWorkspaceInvitationCommandPayload payload;

  const RevokeWorkspaceInvitationCommand({
    required this.contract,
    required this.commandId,
    required this.workspaceId,
    required this.actor,
    required this.payload,
  });

  factory RevokeWorkspaceInvitationCommand.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "commandId", "workspaceId", "actor", "payload"}, "RevokeWorkspaceInvitationCommand");
    return RevokeWorkspaceInvitationCommand(
      contract: _expectStringConst(_requiredKey(json, "contract", "RevokeWorkspaceInvitationCommand"), "workspace.invite-revoke@1", "RevokeWorkspaceInvitationCommand.contract"),
      commandId: _asString(_requiredKey(json, "commandId", "RevokeWorkspaceInvitationCommand"), "RevokeWorkspaceInvitationCommand.commandId"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "RevokeWorkspaceInvitationCommand"), "RevokeWorkspaceInvitationCommand.workspaceId"),
      actor: RevokeWorkspaceInvitationCommandActor.fromJson(_asMap(_requiredKey(json, "actor", "RevokeWorkspaceInvitationCommand"), "RevokeWorkspaceInvitationCommand.actor")),
      payload: RevokeWorkspaceInvitationCommandPayload.fromJson(_asMap(_requiredKey(json, "payload", "RevokeWorkspaceInvitationCommand"), "RevokeWorkspaceInvitationCommand.payload")),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "commandId": commandId,
      "workspaceId": workspaceId,
      "actor": actor.toJson(),
      "payload": payload.toJson(),
    };
    return json;
  }
}

class RevokeWorkspaceInvitationResponse {
  final String contract;
  final WorkspaceInvitationView invitation;
  final bool replayed;

  const RevokeWorkspaceInvitationResponse({
    required this.contract,
    required this.invitation,
    required this.replayed,
  });

  factory RevokeWorkspaceInvitationResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "invitation", "replayed"}, "RevokeWorkspaceInvitationResponse");
    return RevokeWorkspaceInvitationResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "RevokeWorkspaceInvitationResponse"), "workspace.invite-revoke-response@1", "RevokeWorkspaceInvitationResponse.contract"),
      invitation: WorkspaceInvitationView.fromJson(_asMap(_requiredKey(json, "invitation", "RevokeWorkspaceInvitationResponse"), "RevokeWorkspaceInvitationResponse.invitation")),
      replayed: _asBool(_requiredKey(json, "replayed", "RevokeWorkspaceInvitationResponse"), "RevokeWorkspaceInvitationResponse.replayed"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "invitation": invitation.toJson(),
      "replayed": replayed,
    };
    return json;
  }
}

class ClaimWorkspaceInvitationCommandActor {
  final String kind;
  final String punkId;

  const ClaimWorkspaceInvitationCommandActor({
    required this.kind,
    required this.punkId,
  });

  factory ClaimWorkspaceInvitationCommandActor.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "punkId"}, "ClaimWorkspaceInvitationCommandActor");
    return ClaimWorkspaceInvitationCommandActor(
      kind: _expectStringConst(_requiredKey(json, "kind", "ClaimWorkspaceInvitationCommandActor"), "punk", "ClaimWorkspaceInvitationCommandActor.kind"),
      punkId: _asString(_requiredKey(json, "punkId", "ClaimWorkspaceInvitationCommandActor"), "ClaimWorkspaceInvitationCommandActor.punkId"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "punkId": punkId,
    };
    return json;
  }
}

class ClaimWorkspaceInvitationCommandPayload {
  final String code;
  final int expectedRevision;

  const ClaimWorkspaceInvitationCommandPayload({
    required this.code,
    required this.expectedRevision,
  });

  factory ClaimWorkspaceInvitationCommandPayload.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"code", "expectedRevision"}, "ClaimWorkspaceInvitationCommandPayload");
    return ClaimWorkspaceInvitationCommandPayload(
      code: _asString(_requiredKey(json, "code", "ClaimWorkspaceInvitationCommandPayload"), "ClaimWorkspaceInvitationCommandPayload.code"),
      expectedRevision: _asInt(_requiredKey(json, "expectedRevision", "ClaimWorkspaceInvitationCommandPayload"), "ClaimWorkspaceInvitationCommandPayload.expectedRevision"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "code": code,
      "expectedRevision": expectedRevision,
    };
    return json;
  }
}

class ClaimWorkspaceInvitationCommand {
  final String contract;
  final String commandId;
  final String workspaceId;
  final ClaimWorkspaceInvitationCommandActor actor;
  final ClaimWorkspaceInvitationCommandPayload payload;

  const ClaimWorkspaceInvitationCommand({
    required this.contract,
    required this.commandId,
    required this.workspaceId,
    required this.actor,
    required this.payload,
  });

  factory ClaimWorkspaceInvitationCommand.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "commandId", "workspaceId", "actor", "payload"}, "ClaimWorkspaceInvitationCommand");
    return ClaimWorkspaceInvitationCommand(
      contract: _expectStringConst(_requiredKey(json, "contract", "ClaimWorkspaceInvitationCommand"), "workspace.invite-claim@1", "ClaimWorkspaceInvitationCommand.contract"),
      commandId: _asString(_requiredKey(json, "commandId", "ClaimWorkspaceInvitationCommand"), "ClaimWorkspaceInvitationCommand.commandId"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "ClaimWorkspaceInvitationCommand"), "ClaimWorkspaceInvitationCommand.workspaceId"),
      actor: ClaimWorkspaceInvitationCommandActor.fromJson(_asMap(_requiredKey(json, "actor", "ClaimWorkspaceInvitationCommand"), "ClaimWorkspaceInvitationCommand.actor")),
      payload: ClaimWorkspaceInvitationCommandPayload.fromJson(_asMap(_requiredKey(json, "payload", "ClaimWorkspaceInvitationCommand"), "ClaimWorkspaceInvitationCommand.payload")),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "commandId": commandId,
      "workspaceId": workspaceId,
      "actor": actor.toJson(),
      "payload": payload.toJson(),
    };
    return json;
  }
}

enum ClaimWorkspaceInvitationResponseResult {
  joined("joined"),
  alreadyMember("already_member"),
  ;

  const ClaimWorkspaceInvitationResponseResult(this.value);

  final String value;

  factory ClaimWorkspaceInvitationResponseResult.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a ClaimWorkspaceInvitationResponseResult value');
  }

  String toJson() => value;
}

enum ClaimWorkspaceInvitationResponseWorkspaceVisibility {
  private("private"),
  punks("punks"),
  public("public"),
  ;

  const ClaimWorkspaceInvitationResponseWorkspaceVisibility(this.value);

  final String value;

  factory ClaimWorkspaceInvitationResponseWorkspaceVisibility.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a ClaimWorkspaceInvitationResponseWorkspaceVisibility value');
  }

  String toJson() => value;
}

enum ClaimWorkspaceInvitationResponseWorkspaceRole {
  owner("owner"),
  moderator("moderator"),
  member("member"),
  guest("guest"),
  ;

  const ClaimWorkspaceInvitationResponseWorkspaceRole(this.value);

  final String value;

  factory ClaimWorkspaceInvitationResponseWorkspaceRole.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a ClaimWorkspaceInvitationResponseWorkspaceRole value');
  }

  String toJson() => value;
}

class ClaimWorkspaceInvitationResponseWorkspace {
  final String id;
  final String slug;
  final String name;
  final ClaimWorkspaceInvitationResponseWorkspaceVisibility visibility;
  final ClaimWorkspaceInvitationResponseWorkspaceRole role;
  final int revision;

  const ClaimWorkspaceInvitationResponseWorkspace({
    required this.id,
    required this.slug,
    required this.name,
    required this.visibility,
    required this.role,
    required this.revision,
  });

  factory ClaimWorkspaceInvitationResponseWorkspace.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"id", "slug", "name", "visibility", "role", "revision"}, "ClaimWorkspaceInvitationResponseWorkspace");
    return ClaimWorkspaceInvitationResponseWorkspace(
      id: _asString(_requiredKey(json, "id", "ClaimWorkspaceInvitationResponseWorkspace"), "ClaimWorkspaceInvitationResponseWorkspace.id"),
      slug: _asString(_requiredKey(json, "slug", "ClaimWorkspaceInvitationResponseWorkspace"), "ClaimWorkspaceInvitationResponseWorkspace.slug"),
      name: _asString(_requiredKey(json, "name", "ClaimWorkspaceInvitationResponseWorkspace"), "ClaimWorkspaceInvitationResponseWorkspace.name"),
      visibility: ClaimWorkspaceInvitationResponseWorkspaceVisibility.fromJson(_requiredKey(json, "visibility", "ClaimWorkspaceInvitationResponseWorkspace"), "ClaimWorkspaceInvitationResponseWorkspace.visibility"),
      role: ClaimWorkspaceInvitationResponseWorkspaceRole.fromJson(_requiredKey(json, "role", "ClaimWorkspaceInvitationResponseWorkspace"), "ClaimWorkspaceInvitationResponseWorkspace.role"),
      revision: _asInt(_requiredKey(json, "revision", "ClaimWorkspaceInvitationResponseWorkspace"), "ClaimWorkspaceInvitationResponseWorkspace.revision"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "id": id,
      "slug": slug,
      "name": name,
      "visibility": visibility.toJson(),
      "role": role.toJson(),
      "revision": revision,
    };
    return json;
  }
}

class ClaimWorkspaceInvitationResponse {
  final String contract;
  final ClaimWorkspaceInvitationResponseResult result;
  final ClaimWorkspaceInvitationResponseWorkspace workspace;
  final bool replayed;

  const ClaimWorkspaceInvitationResponse({
    required this.contract,
    required this.result,
    required this.workspace,
    required this.replayed,
  });

  factory ClaimWorkspaceInvitationResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "result", "workspace", "replayed"}, "ClaimWorkspaceInvitationResponse");
    return ClaimWorkspaceInvitationResponse(
      contract: _expectStringConst(_requiredKey(json, "contract", "ClaimWorkspaceInvitationResponse"), "workspace.invite-claim-response@1", "ClaimWorkspaceInvitationResponse.contract"),
      result: ClaimWorkspaceInvitationResponseResult.fromJson(_requiredKey(json, "result", "ClaimWorkspaceInvitationResponse"), "ClaimWorkspaceInvitationResponse.result"),
      workspace: ClaimWorkspaceInvitationResponseWorkspace.fromJson(_asMap(_requiredKey(json, "workspace", "ClaimWorkspaceInvitationResponse"), "ClaimWorkspaceInvitationResponse.workspace")),
      replayed: _asBool(_requiredKey(json, "replayed", "ClaimWorkspaceInvitationResponse"), "ClaimWorkspaceInvitationResponse.replayed"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "result": result.toJson(),
      "workspace": workspace.toJson(),
      "replayed": replayed,
    };
    return json;
  }
}

class PresenceHoldFrameHold extends PresenceHoldFrame {
  final String contract;
  final String type;
  final String workspaceId;
  final String deviceId;
  final int clientGeneration;
  final String holdId;

  const PresenceHoldFrameHold({
    required this.contract,
    required this.type,
    required this.workspaceId,
    required this.deviceId,
    required this.clientGeneration,
    required this.holdId,
  }) : super();

  factory PresenceHoldFrameHold.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "type", "workspaceId", "deviceId", "clientGeneration", "holdId"}, "PresenceHoldFrameHold");
    return PresenceHoldFrameHold(
      contract: _expectStringConst(_requiredKey(json, "contract", "PresenceHoldFrameHold"), "presence.hold@1", "PresenceHoldFrameHold.contract"),
      type: _expectStringConst(_requiredKey(json, "type", "PresenceHoldFrameHold"), "hold", "PresenceHoldFrameHold.type"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "PresenceHoldFrameHold"), "PresenceHoldFrameHold.workspaceId"),
      deviceId: _asString(_requiredKey(json, "deviceId", "PresenceHoldFrameHold"), "PresenceHoldFrameHold.deviceId"),
      clientGeneration: _asInt(_requiredKey(json, "clientGeneration", "PresenceHoldFrameHold"), "PresenceHoldFrameHold.clientGeneration"),
      holdId: _asString(_requiredKey(json, "holdId", "PresenceHoldFrameHold"), "PresenceHoldFrameHold.holdId"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "type": type,
      "workspaceId": workspaceId,
      "deviceId": deviceId,
      "clientGeneration": clientGeneration,
      "holdId": holdId,
    };
    return json;
  }
}

class PresenceHoldFrameHeartbeat extends PresenceHoldFrame {
  final String contract;
  final String type;
  final String leaseToken;
  final int sequence;

  const PresenceHoldFrameHeartbeat({
    required this.contract,
    required this.type,
    required this.leaseToken,
    required this.sequence,
  }) : super();

  factory PresenceHoldFrameHeartbeat.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "type", "leaseToken", "sequence"}, "PresenceHoldFrameHeartbeat");
    return PresenceHoldFrameHeartbeat(
      contract: _expectStringConst(_requiredKey(json, "contract", "PresenceHoldFrameHeartbeat"), "presence.hold@1", "PresenceHoldFrameHeartbeat.contract"),
      type: _expectStringConst(_requiredKey(json, "type", "PresenceHoldFrameHeartbeat"), "heartbeat", "PresenceHoldFrameHeartbeat.type"),
      leaseToken: _asString(_requiredKey(json, "leaseToken", "PresenceHoldFrameHeartbeat"), "PresenceHoldFrameHeartbeat.leaseToken"),
      sequence: _asInt(_requiredKey(json, "sequence", "PresenceHoldFrameHeartbeat"), "PresenceHoldFrameHeartbeat.sequence"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "type": type,
      "leaseToken": leaseToken,
      "sequence": sequence,
    };
    return json;
  }
}

sealed class PresenceHoldFrame {
  const PresenceHoldFrame();

  factory PresenceHoldFrame.fromJson(Map<String, Object?> json) {
    switch (json["type"]) {
      case "hold":
        return PresenceHoldFrameHold.fromJson(json);
      case "heartbeat":
        return PresenceHoldFrameHeartbeat.fromJson(json);
      default:
        throw FormatException('PresenceHoldFrame.type has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class SetPresenceStatusSignal {
  final String contract;
  final String leaseToken;
  final int sequence;
  final String? status;

  const SetPresenceStatusSignal({
    required this.contract,
    required this.leaseToken,
    required this.sequence,
    required this.status,
  });

  factory SetPresenceStatusSignal.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "leaseToken", "sequence", "status"}, "SetPresenceStatusSignal");
    return SetPresenceStatusSignal(
      contract: _expectStringConst(_requiredKey(json, "contract", "SetPresenceStatusSignal"), "presence.status.set@1", "SetPresenceStatusSignal.contract"),
      leaseToken: _asString(_requiredKey(json, "leaseToken", "SetPresenceStatusSignal"), "SetPresenceStatusSignal.leaseToken"),
      sequence: _asInt(_requiredKey(json, "sequence", "SetPresenceStatusSignal"), "SetPresenceStatusSignal.sequence"),
      status: _requiredKey(json, "status", "SetPresenceStatusSignal") == null ? null : _asString(_requiredKey(json, "status", "SetPresenceStatusSignal"), "SetPresenceStatusSignal.status"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "leaseToken": leaseToken,
      "sequence": sequence,
      "status": status == null ? null : status!,
    };
    return json;
  }
}

class PresenceTypingSignal {
  final String contract;
  final String leaseToken;
  final int sequence;
  final String workspaceId;
  final String conversationId;
  final bool active;

  const PresenceTypingSignal({
    required this.contract,
    required this.leaseToken,
    required this.sequence,
    required this.workspaceId,
    required this.conversationId,
    required this.active,
  });

  factory PresenceTypingSignal.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "leaseToken", "sequence", "workspaceId", "conversationId", "active"}, "PresenceTypingSignal");
    return PresenceTypingSignal(
      contract: _expectStringConst(_requiredKey(json, "contract", "PresenceTypingSignal"), "presence.typing.signal@1", "PresenceTypingSignal.contract"),
      leaseToken: _asString(_requiredKey(json, "leaseToken", "PresenceTypingSignal"), "PresenceTypingSignal.leaseToken"),
      sequence: _asInt(_requiredKey(json, "sequence", "PresenceTypingSignal"), "PresenceTypingSignal.sequence"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "PresenceTypingSignal"), "PresenceTypingSignal.workspaceId"),
      conversationId: _asString(_requiredKey(json, "conversationId", "PresenceTypingSignal"), "PresenceTypingSignal.conversationId"),
      active: _asBool(_requiredKey(json, "active", "PresenceTypingSignal"), "PresenceTypingSignal.active"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "leaseToken": leaseToken,
      "sequence": sequence,
      "workspaceId": workspaceId,
      "conversationId": conversationId,
      "active": active,
    };
    return json;
  }
}

enum PresenceViewState {
  online("online"),
  away("away"),
  offline("offline"),
  ;

  const PresenceViewState(this.value);

  final String value;

  factory PresenceViewState.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a PresenceViewState value');
  }

  String toJson() => value;
}

class PresenceView {
  final String punkId;
  final PresenceViewState state;
  final String? status;
  final int leaseGeneration;
  final int sequence;
  final String? expiresAt;

  const PresenceView({
    required this.punkId,
    required this.state,
    required this.status,
    required this.leaseGeneration,
    required this.sequence,
    required this.expiresAt,
  });

  factory PresenceView.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"punkId", "state", "status", "leaseGeneration", "sequence", "expiresAt"}, "PresenceView");
    if (!((((_hasKey(json, "state") && (!_hasKey(json, "state") || (_valueAt(json, "state") == "offline"))) ? ((!_hasKey(json, "expiresAt") || ((_valueAt(json, "expiresAt") == null)))) : ((!_hasKey(json, "expiresAt") || ((_valueAt(json, "expiresAt") is String)))))))) {
      throw FormatException("PresenceView violates its structural alternatives");
    }
    return PresenceView(
      punkId: _asString(_requiredKey(json, "punkId", "PresenceView"), "PresenceView.punkId"),
      state: PresenceViewState.fromJson(_requiredKey(json, "state", "PresenceView"), "PresenceView.state"),
      status: _requiredKey(json, "status", "PresenceView") == null ? null : _asString(_requiredKey(json, "status", "PresenceView"), "PresenceView.status"),
      leaseGeneration: _asInt(_requiredKey(json, "leaseGeneration", "PresenceView"), "PresenceView.leaseGeneration"),
      sequence: _asInt(_requiredKey(json, "sequence", "PresenceView"), "PresenceView.sequence"),
      expiresAt: _requiredKey(json, "expiresAt", "PresenceView") == null ? null : _asString(_requiredKey(json, "expiresAt", "PresenceView"), "PresenceView.expiresAt"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "punkId": punkId,
      "state": state.toJson(),
      "status": status == null ? null : status!,
      "leaseGeneration": leaseGeneration,
      "sequence": sequence,
      "expiresAt": expiresAt == null ? null : expiresAt!,
    };
    return json;
  }
}

class PresenceHoldServerFrameAccepted extends PresenceHoldServerFrame {
  final int schemaVersion;
  final String type;
  final String leaseToken;
  final int leaseGeneration;
  final int clientGeneration;
  final int heartbeatIntervalMs;
  final int awayAfterMs;
  final int expiresAfterMs;
  final List<PresenceView> presences;

  const PresenceHoldServerFrameAccepted({
    required this.schemaVersion,
    required this.type,
    required this.leaseToken,
    required this.leaseGeneration,
    required this.clientGeneration,
    required this.heartbeatIntervalMs,
    required this.awayAfterMs,
    required this.expiresAfterMs,
    required this.presences,
  }) : super();

  factory PresenceHoldServerFrameAccepted.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"schemaVersion", "type", "leaseToken", "leaseGeneration", "clientGeneration", "heartbeatIntervalMs", "awayAfterMs", "expiresAfterMs", "presences"}, "PresenceHoldServerFrameAccepted");
    return PresenceHoldServerFrameAccepted(
      schemaVersion: _expectIntConst(_requiredKey(json, "schemaVersion", "PresenceHoldServerFrameAccepted"), 1, "PresenceHoldServerFrameAccepted.schemaVersion"),
      type: _expectStringConst(_requiredKey(json, "type", "PresenceHoldServerFrameAccepted"), "accepted", "PresenceHoldServerFrameAccepted.type"),
      leaseToken: _asString(_requiredKey(json, "leaseToken", "PresenceHoldServerFrameAccepted"), "PresenceHoldServerFrameAccepted.leaseToken"),
      leaseGeneration: _asInt(_requiredKey(json, "leaseGeneration", "PresenceHoldServerFrameAccepted"), "PresenceHoldServerFrameAccepted.leaseGeneration"),
      clientGeneration: _asInt(_requiredKey(json, "clientGeneration", "PresenceHoldServerFrameAccepted"), "PresenceHoldServerFrameAccepted.clientGeneration"),
      heartbeatIntervalMs: _asInt(_requiredKey(json, "heartbeatIntervalMs", "PresenceHoldServerFrameAccepted"), "PresenceHoldServerFrameAccepted.heartbeatIntervalMs"),
      awayAfterMs: _asInt(_requiredKey(json, "awayAfterMs", "PresenceHoldServerFrameAccepted"), "PresenceHoldServerFrameAccepted.awayAfterMs"),
      expiresAfterMs: _asInt(_requiredKey(json, "expiresAfterMs", "PresenceHoldServerFrameAccepted"), "PresenceHoldServerFrameAccepted.expiresAfterMs"),
      presences: _asList(_requiredKey(json, "presences", "PresenceHoldServerFrameAccepted"), "PresenceHoldServerFrameAccepted.presences").map((item) => PresenceView.fromJson(_asMap(item, "PresenceHoldServerFrameAccepted.presences[]"))).toList(growable: false),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "schemaVersion": schemaVersion,
      "type": type,
      "leaseToken": leaseToken,
      "leaseGeneration": leaseGeneration,
      "clientGeneration": clientGeneration,
      "heartbeatIntervalMs": heartbeatIntervalMs,
      "awayAfterMs": awayAfterMs,
      "expiresAfterMs": expiresAfterMs,
      "presences": presences.map((item) => item.toJson()).toList(growable: false),
    };
    return json;
  }
}

class PresenceHoldServerFramePresence extends PresenceHoldServerFrame {
  final int schemaVersion;
  final String type;
  final PresenceView presence;

  const PresenceHoldServerFramePresence({
    required this.schemaVersion,
    required this.type,
    required this.presence,
  }) : super();

  factory PresenceHoldServerFramePresence.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"schemaVersion", "type", "presence"}, "PresenceHoldServerFramePresence");
    return PresenceHoldServerFramePresence(
      schemaVersion: _expectIntConst(_requiredKey(json, "schemaVersion", "PresenceHoldServerFramePresence"), 1, "PresenceHoldServerFramePresence.schemaVersion"),
      type: _expectStringConst(_requiredKey(json, "type", "PresenceHoldServerFramePresence"), "presence", "PresenceHoldServerFramePresence.type"),
      presence: PresenceView.fromJson(_asMap(_requiredKey(json, "presence", "PresenceHoldServerFramePresence"), "PresenceHoldServerFramePresence.presence")),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "schemaVersion": schemaVersion,
      "type": type,
      "presence": presence.toJson(),
    };
    return json;
  }
}

enum PresenceHoldServerFrameRealtimeDegradedReason {
  authorizationUnavailable("authorization_unavailable"),
  capacityUnavailable("capacity_unavailable"),
  ;

  const PresenceHoldServerFrameRealtimeDegradedReason(this.value);

  final String value;

  factory PresenceHoldServerFrameRealtimeDegradedReason.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a PresenceHoldServerFrameRealtimeDegradedReason value');
  }

  String toJson() => value;
}

class PresenceHoldServerFrameRealtimeDegraded extends PresenceHoldServerFrame {
  final int schemaVersion;
  final String type;
  final PresenceHoldServerFrameRealtimeDegradedReason reason;

  const PresenceHoldServerFrameRealtimeDegraded({
    required this.schemaVersion,
    required this.type,
    required this.reason,
  }) : super();

  factory PresenceHoldServerFrameRealtimeDegraded.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"schemaVersion", "type", "reason"}, "PresenceHoldServerFrameRealtimeDegraded");
    return PresenceHoldServerFrameRealtimeDegraded(
      schemaVersion: _expectIntConst(_requiredKey(json, "schemaVersion", "PresenceHoldServerFrameRealtimeDegraded"), 1, "PresenceHoldServerFrameRealtimeDegraded.schemaVersion"),
      type: _expectStringConst(_requiredKey(json, "type", "PresenceHoldServerFrameRealtimeDegraded"), "realtime-degraded", "PresenceHoldServerFrameRealtimeDegraded.type"),
      reason: PresenceHoldServerFrameRealtimeDegradedReason.fromJson(_requiredKey(json, "reason", "PresenceHoldServerFrameRealtimeDegraded"), "PresenceHoldServerFrameRealtimeDegraded.reason"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "schemaVersion": schemaVersion,
      "type": type,
      "reason": reason.toJson(),
    };
    return json;
  }
}

sealed class PresenceHoldServerFrame {
  const PresenceHoldServerFrame();

  factory PresenceHoldServerFrame.fromJson(Map<String, Object?> json) {
    switch (json["type"]) {
      case "accepted":
        return PresenceHoldServerFrameAccepted.fromJson(json);
      case "presence":
        return PresenceHoldServerFramePresence.fromJson(json);
      case "realtime-degraded":
        return PresenceHoldServerFrameRealtimeDegraded.fromJson(json);
      default:
        throw FormatException('PresenceHoldServerFrame.type has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class DesktopPresenceDeliveryAccepted extends DesktopPresenceDelivery {
  final String kind;
  final int clientGeneration;
  final int leaseGeneration;
  final int heartbeatIntervalMs;
  final int awayAfterMs;
  final int expiresAfterMs;
  final List<PresenceView> presences;

  const DesktopPresenceDeliveryAccepted({
    required this.kind,
    required this.clientGeneration,
    required this.leaseGeneration,
    required this.heartbeatIntervalMs,
    required this.awayAfterMs,
    required this.expiresAfterMs,
    required this.presences,
  }) : super();

  factory DesktopPresenceDeliveryAccepted.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "clientGeneration", "leaseGeneration", "heartbeatIntervalMs", "awayAfterMs", "expiresAfterMs", "presences"}, "DesktopPresenceDeliveryAccepted");
    return DesktopPresenceDeliveryAccepted(
      kind: _expectStringConst(_requiredKey(json, "kind", "DesktopPresenceDeliveryAccepted"), "accepted", "DesktopPresenceDeliveryAccepted.kind"),
      clientGeneration: _asInt(_requiredKey(json, "clientGeneration", "DesktopPresenceDeliveryAccepted"), "DesktopPresenceDeliveryAccepted.clientGeneration"),
      leaseGeneration: _asInt(_requiredKey(json, "leaseGeneration", "DesktopPresenceDeliveryAccepted"), "DesktopPresenceDeliveryAccepted.leaseGeneration"),
      heartbeatIntervalMs: _asInt(_requiredKey(json, "heartbeatIntervalMs", "DesktopPresenceDeliveryAccepted"), "DesktopPresenceDeliveryAccepted.heartbeatIntervalMs"),
      awayAfterMs: _asInt(_requiredKey(json, "awayAfterMs", "DesktopPresenceDeliveryAccepted"), "DesktopPresenceDeliveryAccepted.awayAfterMs"),
      expiresAfterMs: _asInt(_requiredKey(json, "expiresAfterMs", "DesktopPresenceDeliveryAccepted"), "DesktopPresenceDeliveryAccepted.expiresAfterMs"),
      presences: _asList(_requiredKey(json, "presences", "DesktopPresenceDeliveryAccepted"), "DesktopPresenceDeliveryAccepted.presences").map((item) => PresenceView.fromJson(_asMap(item, "DesktopPresenceDeliveryAccepted.presences[]"))).toList(growable: false),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "clientGeneration": clientGeneration,
      "leaseGeneration": leaseGeneration,
      "heartbeatIntervalMs": heartbeatIntervalMs,
      "awayAfterMs": awayAfterMs,
      "expiresAfterMs": expiresAfterMs,
      "presences": presences.map((item) => item.toJson()).toList(growable: false),
    };
    return json;
  }
}

class DesktopPresenceDeliveryPresence extends DesktopPresenceDelivery {
  final String kind;
  final PresenceView presence;

  const DesktopPresenceDeliveryPresence({
    required this.kind,
    required this.presence,
  }) : super();

  factory DesktopPresenceDeliveryPresence.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "presence"}, "DesktopPresenceDeliveryPresence");
    return DesktopPresenceDeliveryPresence(
      kind: _expectStringConst(_requiredKey(json, "kind", "DesktopPresenceDeliveryPresence"), "presence", "DesktopPresenceDeliveryPresence.kind"),
      presence: PresenceView.fromJson(_asMap(_requiredKey(json, "presence", "DesktopPresenceDeliveryPresence"), "DesktopPresenceDeliveryPresence.presence")),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "presence": presence.toJson(),
    };
    return json;
  }
}

enum DesktopPresenceDeliveryRealtimeDegradedReason {
  authorizationUnavailable("authorization_unavailable"),
  capacityUnavailable("capacity_unavailable"),
  ;

  const DesktopPresenceDeliveryRealtimeDegradedReason(this.value);

  final String value;

  factory DesktopPresenceDeliveryRealtimeDegradedReason.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a DesktopPresenceDeliveryRealtimeDegradedReason value');
  }

  String toJson() => value;
}

class DesktopPresenceDeliveryRealtimeDegraded extends DesktopPresenceDelivery {
  final String kind;
  final DesktopPresenceDeliveryRealtimeDegradedReason reason;

  const DesktopPresenceDeliveryRealtimeDegraded({
    required this.kind,
    required this.reason,
  }) : super();

  factory DesktopPresenceDeliveryRealtimeDegraded.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"kind", "reason"}, "DesktopPresenceDeliveryRealtimeDegraded");
    return DesktopPresenceDeliveryRealtimeDegraded(
      kind: _expectStringConst(_requiredKey(json, "kind", "DesktopPresenceDeliveryRealtimeDegraded"), "realtime_degraded", "DesktopPresenceDeliveryRealtimeDegraded.kind"),
      reason: DesktopPresenceDeliveryRealtimeDegradedReason.fromJson(_requiredKey(json, "reason", "DesktopPresenceDeliveryRealtimeDegraded"), "DesktopPresenceDeliveryRealtimeDegraded.reason"),
    );
  }

  @override
  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "kind": kind,
      "reason": reason.toJson(),
    };
    return json;
  }
}

sealed class DesktopPresenceDelivery {
  const DesktopPresenceDelivery();

  factory DesktopPresenceDelivery.fromJson(Map<String, Object?> json) {
    switch (json["kind"]) {
      case "accepted":
        return DesktopPresenceDeliveryAccepted.fromJson(json);
      case "presence":
        return DesktopPresenceDeliveryPresence.fromJson(json);
      case "realtime_degraded":
        return DesktopPresenceDeliveryRealtimeDegraded.fromJson(json);
      default:
        throw FormatException('DesktopPresenceDelivery.kind has no matching variant');
    }
  }

  Map<String, Object?> toJson();
}

class MessageSearchQuery {
  final String contract;
  final String workspaceId;
  final String conversationId;
  final String? threadRootMessageId;
  final String query;
  final String? cursor;
  final int limit;

  const MessageSearchQuery({
    required this.contract,
    required this.workspaceId,
    required this.conversationId,
    required this.threadRootMessageId,
    required this.query,
    required this.cursor,
    required this.limit,
  });

  factory MessageSearchQuery.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "workspaceId", "conversationId", "threadRootMessageId", "query", "cursor", "limit"}, "MessageSearchQuery");
    return MessageSearchQuery(
      contract: _expectStringConst(_requiredKey(json, "contract", "MessageSearchQuery"), "message.search@1", "MessageSearchQuery.contract"),
      workspaceId: _asString(_requiredKey(json, "workspaceId", "MessageSearchQuery"), "MessageSearchQuery.workspaceId"),
      conversationId: _asString(_requiredKey(json, "conversationId", "MessageSearchQuery"), "MessageSearchQuery.conversationId"),
      threadRootMessageId: _requiredKey(json, "threadRootMessageId", "MessageSearchQuery") == null ? null : _asString(_requiredKey(json, "threadRootMessageId", "MessageSearchQuery"), "MessageSearchQuery.threadRootMessageId"),
      query: _asString(_requiredKey(json, "query", "MessageSearchQuery"), "MessageSearchQuery.query"),
      cursor: _requiredKey(json, "cursor", "MessageSearchQuery") == null ? null : _asString(_requiredKey(json, "cursor", "MessageSearchQuery"), "MessageSearchQuery.cursor"),
      limit: _asInt(_requiredKey(json, "limit", "MessageSearchQuery"), "MessageSearchQuery.limit"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "contract": contract,
      "workspaceId": workspaceId,
      "conversationId": conversationId,
      "threadRootMessageId": threadRootMessageId == null ? null : threadRootMessageId!,
      "query": query,
      "cursor": cursor == null ? null : cursor!,
      "limit": limit,
    };
    return json;
  }
}

enum MessageSearchResponseCompleteness {
  complete("complete"),
  partial("partial"),
  ;

  const MessageSearchResponseCompleteness(this.value);

  final String value;

  factory MessageSearchResponseCompleteness.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a MessageSearchResponseCompleteness value');
  }

  String toJson() => value;
}

enum MessageSearchResponsePartialReason {
  indexLagging("index_lagging"),
  indexUnavailable("index_unavailable"),
  ;

  const MessageSearchResponsePartialReason(this.value);

  final String value;

  factory MessageSearchResponsePartialReason.fromJson(Object? value, String path) {
    for (final candidate in values) {
      if (candidate.value == value) return candidate;
    }
    throw FormatException('$path must be a MessageSearchResponsePartialReason value');
  }

  String toJson() => value;
}

class MessageSearchResponse {
  final String workspaceId;
  final String conversationId;
  final String? threadRootMessageId;
  final String order;
  final MessageSearchResponseCompleteness completeness;
  final MessageSearchResponsePartialReason? partialReason;
  final List<MessageView> items;
  final String? nextCursor;

  const MessageSearchResponse({
    required this.workspaceId,
    required this.conversationId,
    required this.threadRootMessageId,
    required this.order,
    required this.completeness,
    required this.partialReason,
    required this.items,
    required this.nextCursor,
  });

  factory MessageSearchResponse.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"workspaceId", "conversationId", "threadRootMessageId", "order", "completeness", "partialReason", "items", "nextCursor"}, "MessageSearchResponse");
    if (!((((_hasKey(json, "completeness") && (!_hasKey(json, "completeness") || (_valueAt(json, "completeness") == "complete"))) ? ((!_hasKey(json, "partialReason") || ((_valueAt(json, "partialReason") == null)))) : (true))) && (((_hasKey(json, "completeness") && (!_hasKey(json, "completeness") || (_valueAt(json, "completeness") == "partial"))) ? ((!_hasKey(json, "partialReason") || (const <Object?>["index_lagging", "index_unavailable"].contains(_valueAt(json, "partialReason"))))) : (true))))) {
      throw FormatException("MessageSearchResponse violates its structural alternatives");
    }
    return MessageSearchResponse(
      workspaceId: _asString(_requiredKey(json, "workspaceId", "MessageSearchResponse"), "MessageSearchResponse.workspaceId"),
      conversationId: _asString(_requiredKey(json, "conversationId", "MessageSearchResponse"), "MessageSearchResponse.conversationId"),
      threadRootMessageId: _requiredKey(json, "threadRootMessageId", "MessageSearchResponse") == null ? null : _asString(_requiredKey(json, "threadRootMessageId", "MessageSearchResponse"), "MessageSearchResponse.threadRootMessageId"),
      order: _expectStringConst(_requiredKey(json, "order", "MessageSearchResponse"), "createdCursor-descending", "MessageSearchResponse.order"),
      completeness: MessageSearchResponseCompleteness.fromJson(_requiredKey(json, "completeness", "MessageSearchResponse"), "MessageSearchResponse.completeness"),
      partialReason: _requiredKey(json, "partialReason", "MessageSearchResponse") == null ? null : MessageSearchResponsePartialReason.fromJson(_requiredKey(json, "partialReason", "MessageSearchResponse"), "MessageSearchResponse.partialReason"),
      items: _asList(_requiredKey(json, "items", "MessageSearchResponse"), "MessageSearchResponse.items").map((item) => MessageView.fromJson(_asMap(item, "MessageSearchResponse.items[]"))).toList(growable: false),
      nextCursor: _requiredKey(json, "nextCursor", "MessageSearchResponse") == null ? null : _asString(_requiredKey(json, "nextCursor", "MessageSearchResponse"), "MessageSearchResponse.nextCursor"),
    );
  }

  Map<String, Object?> toJson() {
    final json = <String, Object?>{
      "workspaceId": workspaceId,
      "conversationId": conversationId,
      "threadRootMessageId": threadRootMessageId == null ? null : threadRootMessageId!,
      "order": order,
      "completeness": completeness.toJson(),
      "partialReason": partialReason == null ? null : partialReason!.toJson(),
      "items": items.map((item) => item.toJson()).toList(growable: false),
      "nextCursor": nextCursor == null ? null : nextCursor!,
    };
    return json;
  }
}
