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
  registerPasskey("register_passkey"),
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
  passkey("passkey"),
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
  registerPasskey("register_passkey"),
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

class DesktopAuthStartExchangeRequest extends DesktopAuthStartExchange {
  final String contract;
  final String message;
  final DesktopAuthStartExchangeRequestIntent intent;
  final DesktopAuthStartExchangeRequestMethod method;
  final String verifierCommitment;
  final DesktopAuthStartExchangeRequestPurpose? purpose;
  final String? authorizationId;

  const DesktopAuthStartExchangeRequest({
    required this.contract,
    required this.message,
    required this.intent,
    required this.method,
    required this.verifierCommitment,
    this.purpose,
    this.authorizationId,
  }) : super();

  factory DesktopAuthStartExchangeRequest.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"contract", "message", "intent", "method", "verifierCommitment", "purpose", "authorizationId"}, "DesktopAuthStartExchangeRequest");
    return DesktopAuthStartExchangeRequest(
      contract: _expectStringConst(_requiredKey(json, "contract", "DesktopAuthStartExchangeRequest"), "desktop-auth.start@1", "DesktopAuthStartExchangeRequest.contract"),
      message: _expectStringConst(_requiredKey(json, "message", "DesktopAuthStartExchangeRequest"), "request", "DesktopAuthStartExchangeRequest.message"),
      intent: DesktopAuthStartExchangeRequestIntent.fromJson(_requiredKey(json, "intent", "DesktopAuthStartExchangeRequest"), "DesktopAuthStartExchangeRequest.intent"),
      method: DesktopAuthStartExchangeRequestMethod.fromJson(_requiredKey(json, "method", "DesktopAuthStartExchangeRequest"), "DesktopAuthStartExchangeRequest.method"),
      verifierCommitment: _asString(_requiredKey(json, "verifierCommitment", "DesktopAuthStartExchangeRequest"), "DesktopAuthStartExchangeRequest.verifierCommitment"),
      purpose: json.containsKey("purpose") ? DesktopAuthStartExchangeRequestPurpose.fromJson(json["purpose"], "DesktopAuthStartExchangeRequest.purpose") : null,
      authorizationId: json.containsKey("authorizationId") ? _asString(json["authorizationId"], "DesktopAuthStartExchangeRequest.authorizationId") : null,
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
    return json;
  }
}

enum DesktopAuthStartExchangeResponseIntent {
  signIn("sign_in"),
  switchAccount("switch_account"),
  reauthenticate("reauthenticate"),
  linkGoogle("link_google"),
  linkGithub("link_github"),
  registerPasskey("register_passkey"),
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
  passkey("passkey"),
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
  passkeyAuthenticated("passkey_authenticated"),
  passkeyInvalid("passkey_invalid"),
  passkeyRegistrationPending("passkey_registration_pending"),
  passkeyRegistered("passkey_registered"),
  passkeyUnknownOrInvalid("passkey_unknown_or_invalid"),
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
  registerPasskey("register_passkey"),
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

class DesktopAuthClaimExchangeAuthorization {
  final String authorizationId;
  final String sessionId;
  final String punkId;
  final String intent;
  final DesktopAuthClaimExchangeAuthorizationTargetMethod targetMethod;
  final String handoffId;
  final String expiresAt;

  const DesktopAuthClaimExchangeAuthorization({
    required this.authorizationId,
    required this.sessionId,
    required this.punkId,
    required this.intent,
    required this.targetMethod,
    required this.handoffId,
    required this.expiresAt,
  });

  factory DesktopAuthClaimExchangeAuthorization.fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, const {"authorizationId", "sessionId", "punkId", "intent", "targetMethod", "handoffId", "expiresAt"}, "DesktopAuthClaimExchangeAuthorization");
    return DesktopAuthClaimExchangeAuthorization(
      authorizationId: _asString(_requiredKey(json, "authorizationId", "DesktopAuthClaimExchangeAuthorization"), "DesktopAuthClaimExchangeAuthorization.authorizationId"),
      sessionId: _asString(_requiredKey(json, "sessionId", "DesktopAuthClaimExchangeAuthorization"), "DesktopAuthClaimExchangeAuthorization.sessionId"),
      punkId: _asString(_requiredKey(json, "punkId", "DesktopAuthClaimExchangeAuthorization"), "DesktopAuthClaimExchangeAuthorization.punkId"),
      intent: _expectStringConst(_requiredKey(json, "intent", "DesktopAuthClaimExchangeAuthorization"), "reauthenticate", "DesktopAuthClaimExchangeAuthorization.intent"),
      targetMethod: DesktopAuthClaimExchangeAuthorizationTargetMethod.fromJson(_requiredKey(json, "targetMethod", "DesktopAuthClaimExchangeAuthorization"), "DesktopAuthClaimExchangeAuthorization.targetMethod"),
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
  forbidden("forbidden"),
  notFound("not_found"),
  slugClaimed("slug_claimed"),
  idempotencyConflict("idempotency_conflict"),
  identityConflict("identity_conflict"),
  commandInProgress("command_in_progress"),
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
  passkey("passkey"),
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
