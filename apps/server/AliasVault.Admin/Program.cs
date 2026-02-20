//-----------------------------------------------------------------------
// <copyright file="Program.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

using System.Net;
using System.Reflection;
using AliasServerDb;
using AliasServerDb.Configuration;
using AliasVault.Admin;
using AliasVault.Admin.Auth.Providers;
using AliasVault.Admin.Main;
using AliasVault.Admin.Middleware;
using AliasVault.Admin.Services;
using AliasVault.Auth;
using AliasVault.Cryptography.Server;
using AliasVault.Logging;
using AliasVault.RazorComponents.Services;
using AliasVault.Shared.Models.Configuration;
using AliasVault.Shared.Server.Services;
using AliasVault.Shared.Server.Utilities;
using ApexCharts;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddJsonFile("appsettings.json", optional: false, reloadOnChange: true);
builder.Configuration.AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.json", optional: true, reloadOnChange: true);
builder.Services.ConfigureLogging(builder.Configuration, Assembly.GetExecutingAssembly().GetName().Name!, "../../logs");

// Create global config object, get values from environment variables or container secrets.
var config = new Config();

// Get admin password hash and generation timestamp using SecretReader
// If the admin password hash file doesn't exist, leave config values empty (admin user won't be created)
try
{
    var (adminPasswordHash, lastPasswordChanged) = SecretReader.GetAdminPasswordHash();
    config.AdminPasswordHash = adminPasswordHash;
    config.LastPasswordChanged = lastPasswordChanged;
}
catch (KeyNotFoundException)
{
    // Admin password hash not configured - this is expected when no password has been set yet
    config.AdminPasswordHash = string.Empty;
    config.LastPasswordChanged = DateTime.MinValue;
}

var ipLoggingEnabled = Environment.GetEnvironmentVariable("IP_LOGGING_ENABLED") ?? "false";
config.IpLoggingEnabled = bool.Parse(ipLoggingEnabled);

builder.Services.AddSingleton(config);
builder.Services.AddSingleton<SharedConfig>(sp => sp.GetRequiredService<Config>());

builder.Services.AddAliasVaultDatabaseConfiguration(builder.Configuration);
builder.Services.AddDatabaseDeveloperPageExceptionFilter();
builder.Services.AddAliasVaultDataProtection("AliasVault.Admin");

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

builder.Services.AddCascadingAuthenticationState();
builder.Services.AddScoped<UserService>();
builder.Services.AddScoped<JsInvokeService>();
builder.Services.AddScoped<GlobalNotificationService>();
builder.Services.AddScoped<GlobalLoadingService>();
builder.Services.AddScoped<NavigationService>();
builder.Services.AddScoped<AuthenticationStateProvider, RevalidatingAuthenticationStateProvider>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<AuthLoggingService>();
builder.Services.AddScoped<ConfirmModalService>();
builder.Services.AddScoped<ServerSettingsService>();
builder.Services.AddTransient<StatisticsService>();
builder.Services.AddSingleton(new VersionedContentService(Directory.GetCurrentDirectory() + "/wwwroot"));
builder.Services.AddApexCharts();

builder.Services.AddAuthentication(options =>
    {
        options.DefaultScheme = IdentityConstants.ApplicationScheme;
        options.DefaultSignInScheme = IdentityConstants.ExternalScheme;
    })
    .AddIdentityCookies();

builder.Services.ConfigureApplicationCookie(options =>
{
    options.LoginPath = "/user/login";
});

builder.Services.AddIdentityCore<AdminUser>(options =>
    {
        options.Password.RequireDigit = false;
        options.Password.RequireLowercase = false;
        options.Password.RequireNonAlphanumeric = false;
        options.Password.RequireUppercase = false;
        options.Password.RequiredLength = 8;
        options.Password.RequiredUniqueChars = 0;
        options.SignIn.RequireConfirmedAccount = false;
        options.User.RequireUniqueEmail = false;
        options.Lockout.MaxFailedAccessAttempts = 10;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(30);
    })
    .AddRoles<AdminRole>()
    .AddEntityFrameworkStores<AliasServerDbContext>()
    .AddSignInManager()
    .AddDefaultTokenProviders();

builder.Services.Configure<DataProtectionTokenProviderOptions>(options =>
{
    options.TokenLifespan = TimeSpan.FromDays(30);
    options.Name = "AliasVault.Admin";
});

var app = builder.Build();

// Configure forwarded headers
var forwardedHeadersOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedHost,
    RequireHeaderSymmetry = false,
    ForwardLimit = null,
    ForwardedProtoHeaderName = "X-Forwarded-Proto",
    ForwardedHostHeaderName = "X-Forwarded-Host",
    ForwardedForHeaderName = "X-Forwarded-For",
};
forwardedHeadersOptions.KnownIPNetworks.Clear();
forwardedHeadersOptions.KnownProxies.Clear();
app.UseForwardedHeaders(forwardedHeadersOptions);

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseMigrationsEndPoint();
}
else
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    app.UseHsts();
}

// If the ASPNETCORE_PATHBASE environment variable is set, use it as the path base for the application.
// This is required for running the admin interface behind a reverse proxy on the same port as the client app.
// E.g. default Docker Compose setup makes admin app available on /admin path.
if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ASPNETCORE_PATHBASE")))
{
    app.UsePathBase(Environment.GetEnvironmentVariable("ASPNETCORE_PATHBASE"));
}

app.UseStaticFiles();
app.UseRouting();
app.UseMiddleware<AntiforgeryTokenMiddleware>();
app.UseAntiforgery();
app.UseAuthentication();
app.UseAuthorization();

app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

using (var scope = app.Services.CreateScope())
{
    var container = scope.ServiceProvider;
    var logger = container.GetRequiredService<ILogger<Program>>();
    await using var db = await container.GetRequiredService<IAliasServerDbContextFactory>().CreateDbContextAsync();

    // Wait for migrations to be applied (API project runs them centrally)
    await db.WaitForDatabaseReadyAsync(logger);

    await StartupTasks.CreateRolesIfNotExist(scope.ServiceProvider);
    await StartupTasks.SetAdminUser(scope.ServiceProvider);
}

await app.RunAsync();

namespace AliasVault.Admin
{
    /// <summary>
    /// Explicit program class definition. This is required in order to start the Admin project
    /// in-memory from E2ETests project via WebApplicationFactory.
    /// </summary>
    public partial class Program
    {
    }
}
