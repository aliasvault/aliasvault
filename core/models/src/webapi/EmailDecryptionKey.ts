export type EmailDecryptionKey = {
    /** Position of the public key in the response-level publicKeys table */
    keyIndex: number;

    /** The email's symmetric key, encrypted with the public key */
    encryptedSymmetricKey: string;
}
