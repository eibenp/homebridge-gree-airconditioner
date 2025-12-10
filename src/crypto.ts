import crypto from 'crypto';

const genericKey_v1 = 'a3K8Bx%2r8Y7#xDh';
const genericKey_v2 = '{yxAHAY_Lm6pbC/<';
const iv_v2 = Buffer.from([0x54, 0x40, 0x78, 0x44, 0x49, 0x67, 0x5a, 0x51, 0x6c, 0x5e, 0x63, 0x13]);
const aad_v2 = Buffer.from('qualcomm-test');

export default {
  encrypt_v1: (data: unknown, key = genericKey_v1): string => {
    const str = JSON.stringify(data);
    const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
    return cipher.update(str, 'utf8', 'base64') + cipher.final('base64');
  },
  decrypt_v1: (data: string, key = genericKey_v1) => {
    const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
    return JSON.parse(decipher.update(data, 'base64', 'utf8') + decipher.final('utf8'));
  },
  encrypt_v2: (data: unknown, key = genericKey_v2) => {
    const str = JSON.stringify(data);
    const cipher = crypto.createCipheriv('aes-128-gcm', key, iv_v2).setAAD(aad_v2);
    const pack = cipher.update(str, 'utf8', 'base64') + cipher.final('base64');
    const tag = cipher.getAuthTag().toString('base64');
    return { pack, tag };
  },
  decrypt_v2: (data: string, tag: string, key = genericKey_v2) => {
    const tagbuffer = Buffer.from(tag, 'base64');
    const decipher = crypto.createDecipheriv('aes-128-gcm', key, iv_v2).setAuthTag(tagbuffer).setAAD(aad_v2);
    return JSON.parse(decipher.update(data, 'base64', 'utf8') + decipher.final('utf8'));
  },
};
