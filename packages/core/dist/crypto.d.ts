import { z } from 'zod';

declare const ConfirmationPayloadSchema: z.ZodObject<{
    userId: z.ZodString;
    clientId: z.ZodString;
    toolName: z.ZodString;
    argsHash: z.ZodString;
    summary: z.ZodString;
    exp: z.ZodNumber;
}, z.core.$strip>;
type ConfirmationInput = Omit<z.infer<typeof ConfirmationPayloadSchema>, "exp"> & {
    secret: string;
    ttlMs?: number;
};
declare function seal(plaintext: string, masterKeyB64: string): Promise<string>;
declare function open(sealed: string, masterKeyB64: string): Promise<string>;
declare function hashKey(secret: string): Promise<string>;
declare function verifyKey(secret: string, hash: string): Promise<boolean>;
/**
 * Keys carry a unique lookup prefix (`fak_<8 hex>`) so authentication is one
 * indexed row + one argon2 verify — never a scan of every key in the org.
 */
declare function keyLookup(secret: string): string;
declare function generateApiKey(prefix: "fak" | "fvk" | string): Promise<{
    id: string;
    secret: string;
    hash: string;
    last4: string;
    lookup: string;
}>;
declare function mintConfirmation(input: ConfirmationInput): string;
declare function verifyConfirmation(token: string, secret: string): z.infer<typeof ConfirmationPayloadSchema> | null;

export { type ConfirmationInput, generateApiKey, hashKey, keyLookup, mintConfirmation, open, seal, verifyConfirmation, verifyKey };
