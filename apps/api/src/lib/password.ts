import bcrypt from 'bcryptjs';

export interface PasswordPort {
  hash(plainText: string): Promise<string>;
  verify(plainText: string, hash: string): Promise<boolean>;
}

export class BcryptPasswordService implements PasswordPort {
  constructor(private readonly saltRounds: number) {}

  async hash(plainText: string): Promise<string> {
    return bcrypt.hash(plainText, this.saltRounds);
  }

  async verify(plainText: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plainText, hash);
  }
}
