import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { validatePromotionProfilesContent } from "../promotion-materials-lib.mjs";
import {
  PREUVES_RECUPERATION,
  TYPES_FAUTE,
} from "../promotion-resilience-lib.mjs";
import { assignedResilienceScenarios } from "./resilience-observation.mjs";

const PROMOTION_PROOF_SCHEMA = "punks.promotion-proof.v1";
const EVIDENCE_INDEX_SCHEMA = "punks.promotion-evidence-index.v1";
const PLATFORMS = ["macos-arm64", "macos-x64", "linux-x64", "windows-x64"];

function fail(message) {
  throw new Error(message);
}

function jsonContent(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function memoryFile(content) {
  return {
    path: null,
    content,
    sha256: createHash("sha256").update(content).digest("hex"),
    size: content.length,
  };
}

function parseJsonContent(file, label) {
  try {
    return JSON.parse(file.content.toString("utf8"));
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

/**
 * Closes the four installed legs into one exact recovery fragment. Every
 * recovery proof must cite its fault envelope and capture before the aggregate
 * can add the sole captures summary and `fautes-injectees` gate.
 */
export function buildRecoveryIndex({
  references,
  content,
  sourceSha,
  stagingDeploymentId,
}) {
  if (references.length === 0) return null;
  const profile = validatePromotionProfilesContent(
    readFileSync(
      new URL("../../cloudflare/promotion-profiles.json", import.meta.url),
    ),
    { tranche: 1 },
  );
  const authorities = profile.authorities.map(({ id }) => id);
  const byId = new Map(
    references.map((reference) => [reference.id, reference]),
  );
  const expected = new Set();
  const captures = [];
  for (const platform of PLATFORMS) {
    for (const { type, authority } of assignedResilienceScenarios(
      platform,
      authorities,
    )) {
      const faultId = `faute/${type}/${authority}`;
      expected.add(faultId);
      const faultReference = byId.get(faultId);
      const faultFile = content.get(faultReference?.chemin);
      const faultSubject = content.get(faultReference?.sujet?.chemin);
      if (
        faultReference === undefined ||
        faultFile === undefined ||
        faultSubject === undefined
      ) {
        fail(`Recovery evidence is missing ${faultId}`);
      }
      const fault = parseJsonContent(faultFile, faultId);
      if (
        fault.schema !== PROMOTION_PROOF_SCHEMA ||
        fault.id !== faultId ||
        fault.candidateSha !== sourceSha ||
        fault.stagingDeploymentId !== stagingDeploymentId ||
        fault.plateforme !== platform ||
        fault.result !== "vert" ||
        fault.data?.autorite !== authority ||
        fault.data?.plateforme !== platform ||
        fault.data?.captureSha256 !== faultSubject.sha256 ||
        fault.data?.subjectSha256 !== faultSubject.sha256
      ) {
        fail(`Recovery fault proof ${faultId} is divergent`);
      }
      captures.push({
        type,
        autorite: authority,
        captureSha256: faultSubject.sha256,
      });
      for (const recovery of PREUVES_RECUPERATION) {
        const recoveryId = `recuperation/${recovery}/${type}/${authority}`;
        expected.add(recoveryId);
        const recoveryReference = byId.get(recoveryId);
        const recoveryFile = content.get(recoveryReference?.chemin);
        const recoverySubject = content.get(recoveryReference?.sujet?.chemin);
        if (
          recoveryReference === undefined ||
          recoveryFile === undefined ||
          recoverySubject === undefined
        ) {
          fail(`Recovery evidence is missing ${recoveryId}`);
        }
        const document = parseJsonContent(recoveryFile, recoveryId);
        if (
          document.schema !== PROMOTION_PROOF_SCHEMA ||
          document.id !== recoveryId ||
          document.candidateSha !== sourceSha ||
          document.stagingDeploymentId !== stagingDeploymentId ||
          document.plateforme !== platform ||
          document.result !== "vert" ||
          document.data?.type !== type ||
          document.data?.autorite !== authority ||
          document.data?.plateforme !== platform ||
          document.data?.executionId !== fault.data.executionId ||
          document.data?.fauteSha256 !== faultReference.sha256 ||
          document.data?.sha256Artefact !== fault.data.sha256Artefact ||
          document.data?.captureSha256 !== faultSubject.sha256 ||
          document.data?.subjectSha256 !== recoverySubject.sha256
        ) {
          fail(`Recovery proof ${recoveryId} is not causal`);
        }
      }
    }
  }
  if (
    references.length !== expected.size ||
    references.some((reference) => !expected.has(reference.id))
  ) {
    fail("Recovery evidence set is incomplete or widened");
  }
  captures.sort((left, right) =>
    `${left.type}/${left.autorite}`.localeCompare(
      `${right.type}/${right.autorite}`,
    ),
  );
  const addProof = (id, subjectContent, data) => {
    const subject = memoryFile(subjectContent);
    const safe = id.replaceAll(/[^a-z0-9.-]/giu, "-");
    const subjectPath = `sha256/${subject.sha256}-${safe}-subject.json`;
    content.set(subjectPath, subject);
    const proofContent = jsonContent({
      schema: PROMOTION_PROOF_SCHEMA,
      id,
      candidateSha: sourceSha,
      stagingDeploymentId,
      result: "vert",
      data: { ...data, subjectSha256: subject.sha256 },
    });
    const proof = memoryFile(proofContent);
    const proofPath = `sha256/${proof.sha256}-${safe}.json`;
    content.set(proofPath, proof);
    references.push({
      id,
      chemin: proofPath,
      sha256: proof.sha256,
      sujet: { chemin: subjectPath, sha256: subject.sha256 },
    });
  };
  const capturesContent = jsonContent({
    schema: "punks.recovery-captures.v1",
    captures,
  });
  addProof("recuperation/captures", capturesContent, { captures });
  addProof("gate/fautes-injectees", capturesContent, {
    types: TYPES_FAUTE,
    authorities,
    scenarios: captures.length,
  });
  references.sort((left, right) => left.id.localeCompare(right.id));
  return jsonContent({ schema: EVIDENCE_INDEX_SCHEMA, preuves: references });
}
