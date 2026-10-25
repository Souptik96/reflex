import { describe, expect, it } from 'vitest';
import type { EvidenceLedger } from '@reflex-ai/core';
import {
  EvidenceLedgerBuilder,
  LedgerSigner,
  LedgerVerifier,
  generateSigningKeyPair,
  verifyLedgerIntegrity,
  verifyLedgerSignature,
} from '../src/index.js';

describe('Phase 5: Asymmetric Cryptographic Signing (Ed25519)', () => {
  function createSampleLedger(): EvidenceLedger {
    const builder = new EvidenceLedgerBuilder('task_sig_001');
    builder.recordPreconditionSnapshot('initial_count', 42);
    builder.addToolCalls([
      {
        callId: 'call_abc',
        toolName: 'database.update',
        inputPayload: { id: 'usr_100', role: 'admin' },
        outputPayload: { updated: true },
        isMutation: true,
        httpStatus: 200,
        timestamp: '2026-10-25T10:00:00.000Z',
        latencyMs: 15,
      },
    ]);
    builder.addSandboxLogs(['Log entry 1', 'Log entry 2']);
    builder.addPostconditionCheck({
      layer: 'READ_AFTER_WRITE',
      target: 'database.users',
      expected: 'admin',
      actual: 'admin',
      passed: true,
    });
    return builder.build();
  }

  describe('Key Generation & Signing', () => {
    it('generates valid Ed25519 SPKI keypair', () => {
      const keys = generateSigningKeyPair();
      expect(keys.publicKeyHex).toBeTruthy();
      expect(keys.publicKeyPem).toContain('BEGIN PUBLIC KEY');
      expect(keys.privateKeyPem).toContain('BEGIN PRIVATE KEY');
    });

    it('signs an EvidenceLedger checksum and verifies signature authentic', () => {
      const keys = generateSigningKeyPair();
      const signer = new LedgerSigner({ privateKeyPem: keys.privateKeyPem });

      const unsignedLedger = createSampleLedger();
      expect(unsignedLedger.signature).toBeUndefined();
      expect(verifyLedgerIntegrity(unsignedLedger)).toBe(true);

      const signedLedger = signer.signLedger(unsignedLedger);
      expect(signedLedger.signature).toBeDefined();
      expect(signedLedger.signature?.algorithm).toBe('Ed25519');
      expect(signedLedger.signature?.publicKey).toBe(keys.publicKeyHex);
      expect(signedLedger.signature?.signatureHex).toBeTruthy();

      // Cryptographically verify signature
      const isValid = verifyLedgerSignature(signedLedger);
      expect(isValid).toBe(true);

      // Verify with expected public key
      expect(verifyLedgerSignature(signedLedger, keys.publicKeyHex)).toBe(true);
    });

    it('rejects verification if expected public key does not match', () => {
      const signer1 = new LedgerSigner();
      const signer2 = new LedgerSigner();

      const ledger = signer1.signLedger(createSampleLedger());

      // Verifying against signer1's key succeeds
      expect(verifyLedgerSignature(ledger, signer1.getPublicKeyHex())).toBe(true);
      // Verifying against signer2's key fails
      expect(verifyLedgerSignature(ledger, signer2.getPublicKeyHex())).toBe(false);
    });
  });

  describe('Tamper Resistance & Byzantine Defense', () => {
    it('fails verification when taskId is mutated', () => {
      const signer = new LedgerSigner();
      const signed = signer.signLedger(createSampleLedger());

      const tampered: EvidenceLedger = {
        ...signed,
        taskId: 'task_tampered_999',
      };

      expect(verifyLedgerIntegrity(tampered)).toBe(false);
      expect(verifyLedgerSignature(tampered)).toBe(false);
    });

    it('fails verification when toolCalls input payload is mutated', () => {
      const signer = new LedgerSigner();
      const signed = signer.signLedger(createSampleLedger());

      const tampered: EvidenceLedger = {
        ...signed,
        toolCalls: [
          {
            ...signed.toolCalls[0]!,
            inputPayload: { id: 'usr_100', role: 'superadmin_hacked' },
          },
        ],
      };

      expect(verifyLedgerIntegrity(tampered)).toBe(false);
      expect(verifyLedgerSignature(tampered)).toBe(false);
    });

    it('fails verification when phantom tool calls are injected', () => {
      const signer = new LedgerSigner();
      const signed = signer.signLedger(createSampleLedger());

      const tampered: EvidenceLedger = {
        ...signed,
        toolCalls: [
          ...signed.toolCalls,
          {
            callId: 'call_phantom',
            toolName: 'backdoor.inject',
            inputPayload: {},
            outputPayload: {},
            isMutation: true,
            httpStatus: 200,
            timestamp: new Date().toISOString(),
            latencyMs: 1,
          },
        ],
      };

      expect(verifyLedgerIntegrity(tampered)).toBe(false);
      expect(verifyLedgerSignature(tampered)).toBe(false);
    });

    it('fails verification when sandbox logs or postcondition checks are altered', () => {
      const signer = new LedgerSigner();
      const signed = signer.signLedger(createSampleLedger());

      const tamperedLogs: EvidenceLedger = {
        ...signed,
        sandboxLogs: ['Injected log line'],
      };
      expect(verifyLedgerSignature(tamperedLogs)).toBe(false);

      const tamperedChecks: EvidenceLedger = {
        ...signed,
        postconditionChecks: [],
      };
      expect(verifyLedgerSignature(tamperedChecks)).toBe(false);
    });

    it('fails verification when signatureHex is corrupted', () => {
      const signer = new LedgerSigner();
      const signed = signer.signLedger(createSampleLedger());

      const corruptedSignature: EvidenceLedger = {
        ...signed,
        signature: {
          ...signed.signature!,
          signatureHex: signed.signature!.signatureHex.replace(/^[0-9a-f]/, '0') + 'ff',
        },
      };

      expect(verifyLedgerSignature(corruptedSignature)).toBe(false);
    });

    it('fails verification when raw checksum is manipulated to match forged payload', () => {
      const signer = new LedgerSigner();
      const signed = signer.signLedger(createSampleLedger());

      // Attacker forges tool payload and updates checksum, but cannot forge Ed25519 signature
      const forgedPayload = {
        ...signed,
        taskId: 'forged_task_id',
      };
      const { checksum: _oldChecksum, signature, ...payloadWithoutChecksum } = forgedPayload;

      // Recalculate checksum so integrity matches
      const forgedChecksum = 'beefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef';
      const forgedLedger: EvidenceLedger = {
        ...payloadWithoutChecksum,
        checksum: forgedChecksum,
        signature,
      };

      // Even if attacker tampered, signature fails over the new checksum
      expect(verifyLedgerSignature(forgedLedger)).toBe(false);
    });
  });
});
