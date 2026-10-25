import crypto from 'node:crypto';
import type { EvidenceLedger, LedgerSignature } from '@reflex-ai/core';
import { verifyLedgerIntegrity } from './ledger.js';

export interface SigningKeyPair {
  publicKeyHex: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

/**
 * Generates an Ed25519 keypair for cryptographic evidence ledger notary signing.
 */
export function generateSigningKeyPair(): SigningKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const publicKeyHex = Buffer.from(pubDer).toString('hex');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  return {
    publicKeyHex,
    publicKeyPem,
    privateKeyPem,
  };
}

export class LedgerSigner {
  private readonly privateKey: crypto.KeyObject;
  private readonly publicKeyHex: string;

  constructor(options: { privateKeyPem?: string; keyObject?: crypto.KeyObject } = {}) {
    if (options.keyObject) {
      this.privateKey = options.keyObject;
    } else if (options.privateKeyPem) {
      this.privateKey = crypto.createPrivateKey(options.privateKeyPem);
    } else {
      const generated = crypto.generateKeyPairSync('ed25519');
      this.privateKey = generated.privateKey;
      const pubDer = generated.publicKey.export({ type: 'spki', format: 'der' });
      this.publicKeyHex = Buffer.from(pubDer).toString('hex');
      return;
    }

    const pubKey = crypto.createPublicKey(this.privateKey);
    const pubDer = pubKey.export({ type: 'spki', format: 'der' });
    this.publicKeyHex = Buffer.from(pubDer).toString('hex');
  }

  public getPublicKeyHex(): string {
    return this.publicKeyHex;
  }

  /**
   * Signs the SHA-256 root checksum of an EvidenceLedger using Ed25519.
   */
  public signChecksum(checksum: string): LedgerSignature {
    const signatureBuffer = crypto.sign(
      null,
      Buffer.from(checksum, 'utf8'),
      this.privateKey
    );

    return {
      algorithm: 'Ed25519',
      publicKey: this.publicKeyHex,
      signatureHex: signatureBuffer.toString('hex'),
    };
  }

  /**
   * Cryptographically signs an EvidenceLedger and returns the signed ledger.
   */
  public signLedger(ledger: EvidenceLedger): EvidenceLedger {
    const signature = this.signChecksum(ledger.checksum);
    return {
      ...ledger,
      signature,
    };
  }
}

export class LedgerVerifier {
  /**
   * Verifies an Ed25519 signature against an expected checksum and public key.
   */
  public static verifySignature(
    checksum: string,
    signatureHex: string,
    publicKeyHex: string
  ): boolean {
    try {
      const publicKey = crypto.createPublicKey({
        key: Buffer.from(publicKeyHex, 'hex'),
        type: 'spki',
        format: 'der',
      });

      return crypto.verify(
        null,
        Buffer.from(checksum, 'utf8'),
        publicKey,
        Buffer.from(signatureHex, 'hex')
      );
    } catch {
      return false;
    }
  }
}

/**
 * Validates the end-to-end cryptographic integrity and Ed25519 signature of an EvidenceLedger.
 * Returns true if and only if:
 * 1. The SHA-256 root checksum matches the ledger contents (integrity check).
 * 2. The Ed25519 signature is present and cryptographically authentic.
 * 3. If an expectedPublicKey is provided, the signature matches that specific public key.
 */
export function verifyLedgerSignature(
  ledger: EvidenceLedger,
  expectedPublicKey?: string
): boolean {
  // 1. Verify tamper-resistance of ledger payload against its checksum
  if (!verifyLedgerIntegrity(ledger)) {
    return false;
  }

  // 2. Check presence of signature block
  if (!ledger.signature) {
    return false;
  }

  if (ledger.signature.algorithm !== 'Ed25519') {
    return false;
  }

  if (expectedPublicKey && ledger.signature.publicKey !== expectedPublicKey) {
    return false;
  }

  // 3. Cryptographically verify signature against ledger.checksum
  return LedgerVerifier.verifySignature(
    ledger.checksum,
    ledger.signature.signatureHex,
    ledger.signature.publicKey
  );
}
