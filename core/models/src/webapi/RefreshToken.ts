export type RefreshToken = {
    /**
     * Gets or sets the unique identifier for the refresh token.
     */
    id: string;

    /**
     * Gets or sets the device identifier associated with the refresh token.
     */
    deviceIdentifier: string;

    /**
     * Gets or sets the expiration date of the refresh token.
     */
    expireDate: string;

    /**
     * Gets or sets the creation date of the refresh token.
     */
    createdAt: string;
}
