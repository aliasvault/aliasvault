//-----------------------------------------------------------------------
// <copyright file="AuthController.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the MIT license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers;

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using AliasServerDb;
using AliasVault.Api.Helpers;
using AliasVault.Auth;
using AliasVault.Cryptography.Client;
using AliasVault.Shared.Core;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Models.WebApi.Auth;
using AliasVault.Shared.Models.WebApi.PasswordChange;
using AliasVault.Shared.Providers.Time;
using AliasVault.Shared.Server.Services;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.Tokens;
using SecureRemotePassword;

/// <summary>
/// Auth controller for handling authentication.
/// </summary>
/// <param name="dbContextFactory">AliasServerDbContext instance.</param>
/// <param name="userManager">UserManager instance.</param>
/// <param name="signInManager">SignInManager instance.</param>
/// <param name="configuration">IConfiguration instance.</param>
/// <param name="cache">IMemoryCache instance for persisting SRP values during multistep login process.</param>
/// <param name="timeProvider">ITimeProvider instance. This returns the time which can be mutated for testing.</param>
/// <param name="authLoggingService">AuthLoggingService instance. This is used to log auth attempts to the database.</param>
/// <param name="config">Config instance.</param>
/// <param name="settingsService">ServerSettingsService instance.</param>
[Route("v{version:apiVersion}/[controller]")]
[ApiController]
[ApiVersion("1")]
public class AuthController(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager, SignInManager<AliasVaultUser> signInManager, IConfiguration configuration, IMemoryCache cache, ITimeProvider timeProvider, AuthLoggingService authLoggingService, Config config, ServerSettingsService settingsService) : ControllerBase
{
    /// <summary>
    /// Error message for invalid username or password.
    /// </summary>
    private static readonly string[] InvalidUsernameOrPasswordError = ["Invalid username or password. Please try again."];

    /// <summary>
    /// Error message for invalid 2-factor authentication code.
    /// </summary>
    private static readonly string[] Invalid2FaCode = ["Invalid authenticator code."];

    /// <summary>
    /// Error message for invalid 2-factor authentication recovery code.
    /// </summary>
    private static readonly string[] InvalidRecoveryCode = ["Invalid recovery code."];

    /// <summary>
    /// Error message for too many failed login attempts.
    /// </summary>
    private static readonly string[] AccountLocked = ["You have entered an incorrect password too many times and your account has now been locked out. You can try again in 30 minutes."];

    /// <summary>
    /// Error message for if user is (manually) blocked by admin.
    /// </summary>
    private static readonly string[] AccountBlocked = ["Your account has been disabled. If you believe this is a mistake, please contact support."];

    /// <summary>
    /// Semaphore to prevent concurrent access to the database when generating new tokens for a user.
    /// </summary>
    private static readonly SemaphoreSlim Semaphore = new(1, 1);

    /// <summary>
    /// Status endpoint called by client to check if user is still authenticated and get sync status.
    /// </summary>
    /// <param name="clientHeader">Client header.</param>
    /// <returns>Returns status response if valid authentication is provided, otherwise it will return 401 unauthorized.</returns>
    [Authorize]
    [HttpGet("status")]
    public async Task<IActionResult> Status([FromHeader(Name = "X-AliasVault-Client")] string? clientHeader)
    {
        var user = await userManager.GetUserAsync(User);
        if (user == null)
        {
            return Unauthorized();
        }

        // Get latest vault revision number
        var latestVault = user.Vaults.OrderByDescending(x => x.RevisionNumber).FirstOrDefault();
        var latestRevision = latestVault?.RevisionNumber ?? 0;

        // Check client version compatibility if header is provided
        var clientSupported = false;
        if (!string.IsNullOrEmpty(clientHeader))
        {
            // Client header format should be "{platform}-{version}" e.g. "chrome-1.4.0"
            var parts = clientHeader.Split('-');
            if (parts.Length == 2)
            {
                var platform = parts[0].ToLowerInvariant();
                var clientVersion = parts[1];

                if (AppInfo.MinimumClientVersions.TryGetValue(platform, out var minimumVersion))
                {
                    if (VersionHelper.IsVersionEqualOrNewer(clientVersion, minimumVersion))
                    {
                        clientSupported = true;
                    }
                }
                else
                {
                    // Unknown platform
                    clientSupported = false;
                }
            }
            else
            {
                // Invalid header format
                clientSupported = false;
            }
        }

        return Ok(new StatusResponse
        {
            ClientVersionSupported = clientSupported,
            ServerVersion = AppInfo.GetFullVersion(),
            VaultRevision = latestRevision,
        });
    }

    /// <summary>
    /// Login endpoint used to process login attempt using credentials.
    /// </summary>
    /// <param name="model">Login model.</param>
    /// <returns>IActionResult.</returns>
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginInitiateRequest model)
    {
        var user = await userManager.FindByNameAsync(model.Username);
        if (user == null)
        {
            await authLoggingService.LogAuthEventFailAsync(model.Username, AuthEventType.Login, AuthFailureReason.InvalidUsername);
            return BadRequest(ServerValidationErrorResponse.Create(InvalidUsernameOrPasswordError, 400));
        }

        // Check if the account is locked out.
        if (await userManager.IsLockedOutAsync(user))
        {
            await authLoggingService.LogAuthEventFailAsync(model.Username, AuthEventType.TwoFactorAuthentication, AuthFailureReason.AccountLocked);
            return BadRequest(ServerValidationErrorResponse.Create(AccountLocked, 400));
        }

        // Check if the account is blocked.
        if (user.Blocked)
        {
            await authLoggingService.LogAuthEventFailAsync(model.Username, AuthEventType.Login, AuthFailureReason.AccountBlocked);
            return BadRequest(ServerValidationErrorResponse.Create(AccountBlocked, 400));
        }

        // Retrieve latest vault of user which contains the current salt and verifier.
        var latestVaultEncryptionSettings = AuthHelper.GetUserLatestVaultEncryptionSettings(user);

        // Server creates ephemeral and sends to client
        var ephemeral = Srp.GenerateEphemeralServer(latestVaultEncryptionSettings.Verifier);

        // Store the server ephemeral in memory cache for Validate() endpoint to use.
        cache.Set(AuthHelper.CachePrefixEphemeral + model.Username, ephemeral.Secret, TimeSpan.FromMinutes(5));

        return Ok(new LoginInitiateResponse(latestVaultEncryptionSettings.Salt, ephemeral.Public, latestVaultEncryptionSettings.EncryptionType, latestVaultEncryptionSettings.EncryptionSettings));
    }

    /// <summary>
    /// Validate endpoint used to validate the client's proof and generate the server's proof.
    /// </summary>
    /// <param name="model">ValidateLoginRequest model.</param>
    /// <returns>IActionResult.</returns>
    [HttpPost("validate")]
    public async Task<IActionResult> Validate([FromBody] ValidateLoginRequest model)
    {
        var (user, serverSession, error) = await ValidateUserAndPassword(model);
        if (error is not null)
        {
            // Error occured during validation, return the error.
            return error;
        }

        await authLoggingService.LogAuthEventSuccessAsync(model.Username, AuthEventType.Login);

        // If 2FA is required, return that status and no JWT token yet.
        if (user!.TwoFactorEnabled)
        {
            return Ok(new ValidateLoginResponse(true, string.Empty, null));
        }

        // Reset failed login attempts.
        await userManager.ResetAccessFailedCountAsync(user);

        var tokenModel = await GenerateNewTokensForUser(user, extendedLifetime: model.RememberMe);
        return Ok(new ValidateLoginResponse(false, serverSession!.Proof, tokenModel));
    }

    /// <summary>
    /// Validate login including two-factor authentication code check.
    /// </summary>
    /// <param name="model">ValidateLoginRequest2Fa model.</param>
    /// <returns>Task.</returns>
    [HttpPost("validate-2fa")]
    public async Task<IActionResult> Validate2Fa([FromBody] ValidateLoginRequest2Fa model)
    {
        var (user, serverSession, error) = await ValidateUserAndPassword(model);
        if (error is not null)
        {
            // Error occured during validation, return the error.
            return error;
        }

        if (user == null || serverSession == null)
        {
            // Expected variables are not set, return generic error.
            return BadRequest(ServerValidationErrorResponse.Create(InvalidUsernameOrPasswordError, 400));
        }

        // Verify 2-factor code.
        var verifyResult = await userManager.VerifyTwoFactorTokenAsync(user, userManager.Options.Tokens.AuthenticatorTokenProvider, model.Code2Fa.ToString());
        if (!verifyResult)
        {
            // Increment failed login attempts in order to lock out the account when the limit is reached.
            await userManager.AccessFailedAsync(user);

            await authLoggingService.LogAuthEventFailAsync(model.Username, AuthEventType.TwoFactorAuthentication, AuthFailureReason.InvalidTwoFactorCode);
            return BadRequest(ServerValidationErrorResponse.Create(Invalid2FaCode, 400));
        }

        // Validation of 2-FA token is successful, user is authenticated.
        await authLoggingService.LogAuthEventSuccessAsync(model.Username, AuthEventType.TwoFactorAuthentication);

        // Reset failed login attempts.
        await userManager.ResetAccessFailedCountAsync(user);

        // Generate and return the JWT token.
        var tokenModel = await GenerateNewTokensForUser(user, extendedLifetime: model.RememberMe);
        return Ok(new ValidateLoginResponse(false, serverSession.Proof, tokenModel));
    }

    /// <summary>
    /// Validate login including two-factor authentication recovery code check.
    /// </summary>
    /// <param name="model">ValidateLoginRequestRecoveryCode model.</param>
    /// <returns>Task.</returns>
    [HttpPost("validate-recovery-code")]
    public async Task<IActionResult> ValidateRecoveryCode([FromBody] ValidateLoginRequestRecoveryCode model)
    {
        var (user, serverSession, error) = await ValidateUserAndPassword(model);
        if (error is not null)
        {
            // Error occured during validation, return the error.
            return error;
        }

        if (user == null || serverSession == null)
        {
            // Expected variables are not set, return generic error.
            return BadRequest(ServerValidationErrorResponse.Create(InvalidUsernameOrPasswordError, 400));
        }

        // Sanitize recovery code.
        var recoveryCode = model.RecoveryCode.Replace(" ", string.Empty).ToUpper();

        // Attempt to redeem the recovery code
        var redeemResult = await userManager.RedeemTwoFactorRecoveryCodeAsync(user, recoveryCode);

        if (!redeemResult.Succeeded)
        {
            // Increment failed login attempts in order to lock out the account when the limit is reached.
            await userManager.AccessFailedAsync(user);

            await authLoggingService.LogAuthEventFailAsync(model.Username, AuthEventType.TwoFactorAuthentication, AuthFailureReason.InvalidRecoveryCode);
            return BadRequest(ServerValidationErrorResponse.Create(InvalidRecoveryCode, 400));
        }

        // Recovery code is valid, user is authenticated.
        await authLoggingService.LogAuthEventSuccessAsync(model.Username, AuthEventType.TwoFactorAuthentication);

        // Reset failed login attempts.
        await userManager.ResetAccessFailedCountAsync(user);

        // Generate and return the JWT token.
        var tokenModel = await GenerateNewTokensForUser(user, extendedLifetime: model.RememberMe);
        return Ok(new ValidateLoginResponse(false, serverSession.Proof, tokenModel));
    }

    /// <summary>
    /// Refresh endpoint used to refresh an expired access token using a valid refresh token.
    /// </summary>
    /// <param name="tokenModel">Token model.</param>
    /// <returns>IActionResult.</returns>
    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh([FromBody] TokenModel tokenModel)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        // If the token is not provided, return bad request.
        if (string.IsNullOrWhiteSpace(tokenModel.RefreshToken))
        {
            return BadRequest("Refresh token is required.");
        }

        var principal = GetPrincipalFromToken(tokenModel.Token);
        if (principal.FindFirst(ClaimTypes.NameIdentifier)?.Value == null)
        {
            return Unauthorized("User not found (name-1)");
        }

        var user = await userManager.FindByIdAsync(principal.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? string.Empty);
        if (user == null)
        {
            return Unauthorized("User not found (name-2)");
        }

        // Check if the account is blocked.
        if (user.Blocked)
        {
            await authLoggingService.LogAuthEventFailAsync(user.UserName!, AuthEventType.TokenRefresh, AuthFailureReason.AccountBlocked);
            return Unauthorized("Account blocked");
        }

        // Generate new tokens for the user.
        var token = await GenerateNewTokensForUser(user, tokenModel.RefreshToken);
        if (token == null)
        {
            await authLoggingService.LogAuthEventFailAsync(user.UserName!, AuthEventType.TokenRefresh, AuthFailureReason.InvalidRefreshToken);
            return Unauthorized("Invalid refresh token");
        }

        await context.SaveChangesAsync();

        await authLoggingService.LogAuthEventSuccessAsync(user.UserName!, AuthEventType.TokenRefresh);
        return Ok(new TokenModel() { Token = token.Token, RefreshToken = token.RefreshToken });
    }

    /// <summary>
    /// Revoke endpoint used to revoke a refresh token.
    /// </summary>
    /// <param name="model">Token model.</param>
    /// <returns>IActionResult.</returns>
    [HttpPost("revoke")]
    public async Task<IActionResult> Revoke([FromBody] TokenModel model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        // If the token is not provided, return bad request.
        if (string.IsNullOrWhiteSpace(model.RefreshToken))
        {
            return BadRequest("Refresh token is required.");
        }

        var principal = GetPrincipalFromToken(model.Token);
        if (principal.FindFirst(ClaimTypes.NameIdentifier)?.Value == null)
        {
            return Unauthorized("User not found (name-1)");
        }

        var user = await userManager.FindByIdAsync(principal.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? string.Empty);
        if (user == null)
        {
            return Unauthorized("User not found (name-2)");
        }

        // Check if the refresh token is valid.
        var providedTokenExists = await context.AliasVaultUserRefreshTokens.AnyAsync(t => t.UserId == user.Id && t.Value == model.RefreshToken);
        if (!providedTokenExists)
        {
            await authLoggingService.LogAuthEventFailAsync(user.UserName!, AuthEventType.Logout, AuthFailureReason.InvalidRefreshToken);
            return Unauthorized("Invalid refresh token");
        }

        // Remove the provided refresh token and any other existing refresh tokens that are issued to the current device ID.
        // This to make sure all tokens are revoked for this device that user is "logging out" from.
        var deviceIdentifier = GenerateDeviceIdentifier(Request);
        var allDeviceTokens = await context.AliasVaultUserRefreshTokens.Where(t => t.UserId == user.Id && (t.Value == model.RefreshToken || t.DeviceIdentifier == deviceIdentifier)).ToListAsync();
        context.AliasVaultUserRefreshTokens.RemoveRange(allDeviceTokens);
        await context.SaveChangesAsync();

        await authLoggingService.LogAuthEventSuccessAsync(user.UserName!, AuthEventType.Logout);
        return Ok("Refresh token revoked successfully");
    }

    /// <summary>
    /// Register endpoint used to register a new user.
    /// </summary>
    /// <param name="model">Register request model.</param>
    /// <returns>IActionResult.</returns>
    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest model)
    {
        // Check if public registration is disabled in the configuration.
        if (!config.PublicRegistrationEnabled)
        {
            return BadRequest(ServerValidationErrorResponse.Create(["New account registration is currently disabled on this server. Please contact the administrator."], 400));
        }

        // Validate the username.
        var (isValid, errorMessage) = ValidateUsername(model.Username);
        if (!isValid)
        {
            return BadRequest(ServerValidationErrorResponse.Create([errorMessage], 400));
        }

        var user = new AliasVaultUser
        {
            UserName = model.Username,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
            PasswordChangedAt = timeProvider.UtcNow,
        };

        user.Vaults.Add(new AliasServerDb.Vault
        {
            VaultBlob = string.Empty,
            Version = "0.0.0",
            RevisionNumber = 0,
            Salt = model.Salt,
            Verifier = model.Verifier,
            EncryptionType = model.EncryptionType,
            EncryptionSettings = model.EncryptionSettings,
            FileSize = 0,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
        });

        var result = await userManager.CreateAsync(user);

        if (result.Succeeded)
        {
            await authLoggingService.LogAuthEventSuccessAsync(model.Username, AuthEventType.Register);

            // When a user is registered, they are automatically signed in.
            await signInManager.SignInAsync(user, isPersistent: false);

            // Return the token.
            var tokenModel = await GenerateNewTokensForUser(user, extendedLifetime: true);
            return Ok(tokenModel);
        }

        var errors = result.Errors.Select(e => e.Description).ToArray();
        return BadRequest(ServerValidationErrorResponse.Create(errors, 400));
    }

    /// <summary>
    /// Password change request is done by verifying the current password and then saving the new password via SRP.
    /// </summary>
    /// <remarks>The submit handler for the change password logic is in VaultController.UpdateChangePassword()
    /// because changing the password of the AliasVault user also requires a new vault encrypted with that same
    /// password in order for things to work properly.</remarks>
    /// <returns>Task.</returns>
    [HttpGet("change-password/initiate")]
    [Authorize]
    public async Task<IActionResult> InitiatePasswordChange()
    {
        var user = await userManager.GetUserAsync(User);
        if (user == null)
        {
            return NotFound(ServerValidationErrorResponse.Create("User not found.", 404));
        }

        // Retrieve latest vault of user which contains the current salt and verifier.
        var latestVaultEncryptionSettings = AuthHelper.GetUserLatestVaultEncryptionSettings(user);

        // Server creates ephemeral and sends to client
        var ephemeral = Srp.GenerateEphemeralServer(latestVaultEncryptionSettings.Verifier);

        // Store the server ephemeral in memory cache for the Vault update (and set new password) endpoint to use.
        cache.Set(AuthHelper.CachePrefixEphemeral + user.UserName!, ephemeral.Secret, TimeSpan.FromMinutes(5));

        return Ok(new PasswordChangeInitiateResponse(latestVaultEncryptionSettings.Salt, ephemeral.Public, latestVaultEncryptionSettings.EncryptionType, latestVaultEncryptionSettings.EncryptionSettings));
    }

    /// <summary>
    /// Validate username endpoint used to check if a username is available.
    /// </summary>
    /// <param name="model">ValidateUsernameRequest model.</param>
    /// <returns>IActionResult.</returns>
    [HttpPost("validate-username")]
    [AllowAnonymous]
    public async Task<IActionResult> ValidateUsername([FromBody] ValidateUsernameRequest model)
    {
        if (string.IsNullOrWhiteSpace(model.Username))
        {
            return BadRequest("Username is required.");
        }

        var normalizedUsername = NormalizeUsername(model.Username);
        var existingUser = await userManager.FindByNameAsync(normalizedUsername);

        if (existingUser != null)
        {
            return BadRequest("Username is already in use.");
        }

        // Validate the username
        var (isValid, errorMessage) = ValidateUsername(normalizedUsername);

        if (!isValid)
        {
            return BadRequest(errorMessage);
        }

        return Ok("Username is available.");
    }

    /// <summary>
    /// Initiates the account deletion process.
    /// </summary>
    /// <param name="model">The login initiate request model.</param>
    /// <returns>IActionResult.</returns>
    [HttpPost("delete-account/initiate")]
    [Authorize]
    public async Task<IActionResult> InitiateAccountDeletion([FromBody] LoginInitiateRequest model)
    {
        var user = await userManager.GetUserAsync(User);
        if (user == null)
        {
            return NotFound(ServerValidationErrorResponse.Create("User not found.", 404));
        }

        // Verify the username matches the current user.
        if (user.UserName != model.Username)
        {
            return BadRequest(ServerValidationErrorResponse.Create("Username does not match the current user.", 400));
        }

        // Retrieve latest vault of user which contains the current salt and verifier.
        var latestVaultEncryptionSettings = AuthHelper.GetUserLatestVaultEncryptionSettings(user);

        // Server creates ephemeral and sends to client
        var ephemeral = Srp.GenerateEphemeralServer(latestVaultEncryptionSettings.Verifier);

        // Store the server ephemeral in memory cache for confirmation endpoint.
        cache.Set(AuthHelper.CachePrefixEphemeral + model.Username, ephemeral.Secret, TimeSpan.FromMinutes(5));

        return Ok(new LoginInitiateResponse(
            latestVaultEncryptionSettings.Salt,
            ephemeral.Public,
            latestVaultEncryptionSettings.EncryptionType,
            latestVaultEncryptionSettings.EncryptionSettings));
    }

    /// <summary>
    /// Confirms the account deletion process.
    /// </summary>
    /// <param name="model">The login initiate request model.</param>
    /// <returns>IActionResult.</returns>
    [HttpPost("delete-account/confirm")]
    [Authorize]
    public async Task<IActionResult> ConfirmAccountDeletion([FromBody] DeleteAccountRequest model)
    {
        var user = await userManager.GetUserAsync(User);
        if (user == null)
        {
            return NotFound(ServerValidationErrorResponse.Create("User not found.", 404));
        }

        // Verify the username matches the current user.
        if (user.UserName != model.Username)
        {
            return BadRequest(ServerValidationErrorResponse.Create("Username does not match the current user.", 400));
        }

        // Validate the SRP session (actual password check).
        var serverSession = AuthHelper.ValidateSrpSession(cache, user, model.ClientPublicEphemeral, model.ClientSessionProof);
        if (serverSession is null)
        {
            await authLoggingService.LogAuthEventFailAsync(user.UserName!, AuthEventType.AccountDeletion, AuthFailureReason.InvalidPassword);
            return BadRequest(ServerValidationErrorResponse.Create("The provided password does not match your current password.", 400));
        }

        // Log the successful account deletion.
        await authLoggingService.LogAuthEventSuccessAsync(user.UserName!, AuthEventType.AccountDeletion);

        // Delete the user and their data.
        await using var context = await dbContextFactory.CreateDbContextAsync();
        context.AliasVaultUsers.Remove(user);
        await context.SaveChangesAsync();

        return Ok(new { message = "Account successfully deleted." });
    }

    /// <summary>
    /// Normalizes a username by trimming and lowercasing it.
    /// </summary>
    /// <param name="username">The username to normalize.</param>
    /// <returns>The normalized username.</returns>
    private static string NormalizeUsername(string username)
    {
        return username.ToLowerInvariant().Trim();
    }

    /// <summary>
    /// Validates if a given username meets the required criteria.
    /// </summary>
    /// <param name="username">The username to validate.</param>
    /// <returns>A tuple containing a boolean indicating if the username is valid, and an error message if it's invalid.</returns>
    private static (bool IsValid, string ErrorMessage) ValidateUsername(string username)
    {
        const int minimumUsernameLength = 3;
        const int maximumUsernameLength = 40;
        const string adminUsername = "admin";

        if (string.IsNullOrWhiteSpace(username))
        {
            return (false, "Username cannot be empty or whitespace.");
        }

        if (username.Length < minimumUsernameLength)
        {
            return (false, $"Username too short: must be at least {minimumUsernameLength} characters long.");
        }

        if (username.Length > maximumUsernameLength)
        {
            return (false, $"Username too long: cannot be longer than {maximumUsernameLength} characters.");
        }

        if (string.Equals(username, adminUsername, StringComparison.OrdinalIgnoreCase))
        {
            return (false, "Username 'admin' is not allowed.");
        }

        // Check if it's a valid email address
        if (username.Contains('@'))
        {
            try
            {
                var addr = new System.Net.Mail.MailAddress(username);
                return (addr.Address == username, string.Empty);
            }
            catch
            {
                return (false, $"'{username}' is not a valid email address.");
            }
        }

        // If it's not an email, check if it only contains letters and digits
        if (!username.All(char.IsLetterOrDigit))
        {
            return (false, $"Username '{username}' is invalid, can only contain letters or digits.");
        }

        return (true, string.Empty);
    }

    /// <summary>
    /// Generate a device identifier based on request headers. This is used to associate refresh tokens
    /// with a specific device for a specific user.
    ///
    /// NOTE: current implementation means that only one refresh token can be valid for a
    /// specific user/device combo at a time. The identifier generation could be made more unique in the future
    /// to prevent any unwanted conflicts.
    /// </summary>
    /// <param name="request">The HttpRequest instance for the request that the client used.</param>
    /// <returns>Unique device identifier as string.</returns>
    private static string GenerateDeviceIdentifier(HttpRequest request)
    {
        var userAgent = request.Headers.UserAgent.ToString();
        var acceptLanguage = request.Headers.AcceptLanguage.ToString();

        var rawIdentifier = $"{userAgent}|{acceptLanguage}";
        return rawIdentifier;
    }

    /// <summary>
    /// Generate a refresh token for a user. This token is used to request a new access token when the current
    /// access token expires. The refresh token is long-lived by design.
    /// </summary>
    /// <returns>Random string to be used as refresh token.</returns>
    private static string GenerateRefreshToken()
    {
        var randomNumber = new byte[32];
        using var rng = RandomNumberGenerator.Create();

        rng.GetBytes(randomNumber);
        return Convert.ToBase64String(randomNumber);
    }

    /// <summary>
    /// Get the JWT key from the environment variables.
    /// </summary>
    /// <returns>JWT key as string.</returns>
    /// <exception cref="KeyNotFoundException">Thrown if environment variable does not exist.</exception>
    private static string GetJwtKey()
    {
        var jwtKey = Environment.GetEnvironmentVariable("JWT_KEY");
        if (jwtKey is null)
        {
            throw new KeyNotFoundException("JWT_KEY environment variable is not set.");
        }

        return jwtKey;
    }

    /// <summary>
    /// Get the principal from a token. This is used to validate the token and extract the user.
    /// </summary>
    /// <param name="token">The token as string.</param>
    /// <returns>Claims principal.</returns>
    /// <exception cref="SecurityTokenException">Thrown if provided token is invalid.</exception>
    private static ClaimsPrincipal GetPrincipalFromToken(string token)
    {
        var tokenValidationParameters = new TokenValidationParameters
        {
            ValidateAudience = false,
            ValidateIssuer = false,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(GetJwtKey())),

            // We don't validate the token lifetime here, as we only use it for refresh tokens.
            ValidateLifetime = false,
        };

        var tokenHandler = new JwtSecurityTokenHandler();
        var principal = tokenHandler.ValidateToken(token, tokenValidationParameters, out SecurityToken securityToken);
        if (securityToken is not JwtSecurityToken jwtSecurityToken || !jwtSecurityToken.Header.Alg.Equals(SecurityAlgorithms.HmacSha256, StringComparison.InvariantCultureIgnoreCase))
        {
            throw new SecurityTokenException("Invalid token");
        }

        return principal;
    }

    /// <summary>
    /// Validates the user and SRP session (password). If the user is not found or the password is invalid an
    /// action result is returned with the appropriate error message. If everything is valid nothing is returned.
    /// </summary>
    /// <param name="model">ValidateLoginRequest model.</param>
    /// <returns>User and SrpSession object if validation succeeded, IActionResult as error on error.</returns>
    private async Task<(AliasVaultUser? User, SrpSession? ServerSession, IActionResult? Error)> ValidateUserAndPassword(ValidateLoginRequest model)
    {
        var user = await userManager.FindByNameAsync(model.Username);
        if (user == null)
        {
            await authLoggingService.LogAuthEventFailAsync(model.Username, AuthEventType.Login, AuthFailureReason.InvalidUsername);
            return (null, null, BadRequest(ServerValidationErrorResponse.Create(InvalidUsernameOrPasswordError, 400)));
        }

        // Check if the account is locked out.
        if (await userManager.IsLockedOutAsync(user))
        {
            await authLoggingService.LogAuthEventFailAsync(user.UserName!, AuthEventType.TwoFactorAuthentication, AuthFailureReason.AccountLocked);
            return (null, null, BadRequest(ServerValidationErrorResponse.Create(AccountLocked, 400)));
        }

        // Check if the account is blocked.
        if (user.Blocked)
        {
            await authLoggingService.LogAuthEventFailAsync(model.Username, AuthEventType.Login, AuthFailureReason.AccountBlocked);
            return (null, null, BadRequest(ServerValidationErrorResponse.Create(AccountBlocked, 400)));
        }

        // Validate the SRP session (actual password check).
        var serverSession = AuthHelper.ValidateSrpSession(cache, user, model.ClientPublicEphemeral, model.ClientSessionProof);
        if (serverSession is null)
        {
            // Increment failed login attempts in order to lock out the account when the limit is reached.
            await userManager.AccessFailedAsync(user);

            await authLoggingService.LogAuthEventFailAsync(user.UserName!, AuthEventType.Login, AuthFailureReason.InvalidPassword);
            return (null, null, BadRequest(ServerValidationErrorResponse.Create(InvalidUsernameOrPasswordError, 400)));
        }

        return (user, serverSession, null);
    }

    /// <summary>
    /// Generate a Jwt access token for a user. This token is used to authenticate the user for a limited time
    /// and is short-lived by design. With the separate refresh token, the user can request a new access token
    /// when this access token expires.
    /// </summary>
    /// <param name="user">The user to generate the Jwt access token for.</param>
    /// <returns>Access token as string.</returns>
    private string GenerateJwtToken(AliasVaultUser user)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id),
            new(ClaimTypes.Name, user.UserName ?? string.Empty),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(GetJwtKey()));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: configuration["Jwt:Issuer"] ?? string.Empty,
            audience: configuration["Jwt:Issuer"] ?? string.Empty,
            claims: claims,
            expires: timeProvider.UtcNow.AddMinutes(10),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>
    /// Generates a new access and refresh token for a user and persists the refresh token
    /// to the database.
    /// </summary>
    /// <param name="user">The user to generate the tokens for.</param>
    /// <param name="extendedLifetime">If true, the refresh token will have an extended lifetime (remember me option).</param>
    private async Task<TokenModel> GenerateNewTokensForUser(AliasVaultUser user, bool extendedLifetime = false)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var settings = await settingsService.GetAllSettingsAsync();

        await Semaphore.WaitAsync();
        try
        {
            // Use server settings for refresh token lifetime.
            var refreshTokenLifetimeHours = extendedLifetime ? settings.RefreshTokenLifetimeLong : settings.RefreshTokenLifetimeShort;
            var refreshTokenLifetime = TimeSpan.FromHours(refreshTokenLifetimeHours);

            // Return new refresh token.
            return await GenerateRefreshToken(user, refreshTokenLifetime);
        }
        finally
        {
            Semaphore.Release();
        }
    }

    /// <summary>
    /// Generates a new access and refresh token for a user and persists the refresh token
    /// to the database.
    /// </summary>
    /// <param name="user">The user to generate the tokens for.</param>
    /// <param name="existingTokenValue">The existing token value that is being replaced (optional).</param>
    /// <returns>TokenModel which includes new access and refresh token. Returns null if provided refresh token is invalid.</returns>
    private async Task<TokenModel?> GenerateNewTokensForUser(AliasVaultUser user, string existingTokenValue)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await Semaphore.WaitAsync();

        try
        {
            // Token reuse window:
            // Check if a new refresh token was already generated for the current token in the last 30 seconds.
            // If yes, then return the already generated new token. This is to prevent client-side race conditions.
            var existingTokenReuseWindow = timeProvider.UtcNow.AddSeconds(-30);
            var existingTokenReuse = await context.AliasVaultUserRefreshTokens
                .FirstOrDefaultAsync(t => t.UserId == user.Id &&
                                            t.PreviousTokenValue == existingTokenValue &&
                                            t.CreatedAt > existingTokenReuseWindow);

            if (existingTokenReuse is not null)
            {
                // A new token was already generated for the current token in the last 30 seconds.
                // Return the already generated new token.
                var accessToken = GenerateJwtToken(user);
                return new TokenModel { Token = accessToken, RefreshToken = existingTokenReuse.Value };
            }

            // Check if the refresh token still exists and is not expired.
            var existingToken = await context.AliasVaultUserRefreshTokens.FirstOrDefaultAsync(t => t.UserId == user.Id && t.Value == existingTokenValue);
            if (existingToken == null || existingToken.ExpireDate < timeProvider.UtcNow)
            {
                return null;
            }

            context.AliasVaultUserRefreshTokens.Remove(existingToken);

            // New refresh token lifetime is the same as the existing one.
            var existingTokenLifetime = existingToken.ExpireDate - existingToken.CreatedAt;

            // Retrieve new refresh token.
            var newRefreshToken = await GenerateRefreshToken(user, existingTokenLifetime, existingToken.Value);

            // After successfully retrieving new refresh token, remove the existing one by saving changes.
            await context.SaveChangesAsync();

            // Return new refresh token.
            return newRefreshToken;
        }
        finally
        {
            Semaphore.Release();
        }
    }

    /// <summary>
    /// Generates a new access and refresh token for a user and persists the refresh token
    /// to the database.
    /// </summary>
    /// <param name="user">The user to generate the tokens for.</param>
    /// <param name="newTokenLifetime">The lifetime of the new token.</param>
    /// <param name="existingTokenValue">The existing token value that is being replaced (optional).</param>
    /// <returns>TokenModel which includes new access and refresh token.</returns>
    private async Task<TokenModel> GenerateRefreshToken(AliasVaultUser user, TimeSpan newTokenLifetime, string? existingTokenValue = null)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

         // Generate device identifier
        var accessToken = GenerateJwtToken(user);
        var refreshToken = GenerateRefreshToken();
        var deviceIdentifier = GenerateDeviceIdentifier(Request);

        // Add new refresh token.
        context.AliasVaultUserRefreshTokens.Add(new AliasVaultUserRefreshToken
        {
            UserId = user.Id,
            DeviceIdentifier = deviceIdentifier,
            IpAddress = IpAddressUtility.GetIpFromContext(HttpContext),
            Value = refreshToken,
            PreviousTokenValue = existingTokenValue,
            ExpireDate = timeProvider.UtcNow.Add(newTokenLifetime),
            CreatedAt = timeProvider.UtcNow,
        });

        await context.SaveChangesAsync();
        return new TokenModel { Token = accessToken, RefreshToken = refreshToken };
    }
}
