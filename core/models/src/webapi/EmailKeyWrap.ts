export type EmailKeyWrap = {
    /** The public key whose private half unwraps this wrap */
    publicKey: string;

    /** The email's symmetric key, encrypted with the public key */
    encryptedSymmetricKey: string;
}
