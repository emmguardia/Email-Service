import jwt from 'jsonwebtoken';
import { readFileSync } from 'fs';
import { logger } from './logger.js';
import { config } from './config.js';

class JWTHandler {
  constructor() {
    this.privateKeyPath = config.jwt.privateKeyPath;
    this.publicKeyPath = config.jwt.publicKeyPath;
    this.algorithm = config.jwt.algorithm;
    this.expirationHours = config.jwt.expirationHours;
    this.issuer = config.jwt.issuer;
    this.audience = config.jwt.audience;

    this._privateKey = null;
    this._publicKey = null;
    this._keysLoaded = false;
  }

  _loadKeys() {
    if (this._keysLoaded) return;
    try {
      this._privateKey = readFileSync(this.privateKeyPath, 'utf8');
      this._publicKey = readFileSync(this.publicKeyPath, 'utf8');
      logger.info({ algorithm: this.algorithm }, 'jwt_keys_loaded');
      this._keysLoaded = true;
    } catch (error) {
      logger.error({ error: error.message, path: this.privateKeyPath }, 'jwt_keys_not_found');
      throw new Error(`JWT keys not found: ${error.message}`);
    }
  }

  sign(payload, expiresInHours = null) {
    this._loadKeys();

    const expirationHours = expiresInHours ?? this.expirationHours;

    if (!payload || typeof payload !== 'object') {
      throw new Error('payload must be an object');
    }
    if (!payload.project) {
      throw new Error('payload.project is required');
    }

    const fullPayload = {
      ...payload,
      iat: Math.floor(Date.now() / 1000),
    };

    const opts = {
      algorithm: this.algorithm,
      expiresIn: `${expirationHours}h`,
      issuer: this.issuer,
    };
    if (this.audience) opts.audience = this.audience;

    try {
      return jwt.sign(fullPayload, this._privateKey, opts);
    } catch (error) {
      logger.error({ error: error.message }, 'jwt_sign_error');
      throw new Error('Failed to generate token');
    }
  }

  verify(token) {
    this._loadKeys();
    const opts = {
      algorithms: [this.algorithm],
      issuer: this.issuer,
      clockTolerance: 5,
    };
    if (this.audience) opts.audience = this.audience;

    try {
      const payload = jwt.verify(token, this._publicKey, opts);
      if (!payload.project) {
        throw new Error('Token missing project claim');
      }
      return payload;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        logger.warn('jwt_expired');
        throw new Error('Token expired');
      }
      if (error.name === 'JsonWebTokenError') {
        logger.warn({ error: error.message }, 'jwt_invalid');
        throw new Error('Invalid token');
      }
      logger.error({ error: error.message }, 'jwt_verify_error');
      throw new Error('Token validation failed');
    }
  }
}

export const jwtHandler = new JWTHandler();
