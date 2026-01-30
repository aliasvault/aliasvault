//-----------------------------------------------------------------------
// <copyright file="Program.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using AliasServerDb;
using AliasServerDb.Configuration;
using AliasVault.Api;
using AliasVault.Api.Jwt;
using AliasVault.Auth;
using AliasVault.Cryptography.Server;
using AliasVault.Logging;
using AliasVault.Shared.Models.Configuration;
using AliasVault.Shared.Providers.Time;
using AliasVault.Shared.Server.Services;
using AliasVault.Shared.Server.Utilities;
using Asp.Versioning;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;

var builder = WebApplication.CreateBuilder(args);

// Force invariant culture to prevent regional date formatting issues
// (e.g., times should be formatted as "09:03:09" instead of alternate region formats like "09.03.09").
CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.InvariantCulture;

builder.Configuration.AddJsonFile("appsettings.json", optional: false, reloadOnChange: true);
builder.Configuration.AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.json", optional: true, reloadOnChange: true);

var config = new Config();
var publicRegistrationEnabled = Environment.GetEnvironmentVariable("PUBLIC_REGISTRATION_ENABLED") ?? "false";
config.PublicRegistrationEnabled = bool.Parse(publicRegistrationEnabled);

var privateEmailDomains = Environment.GetEnvironmentVariable("PRIVATE_EMAIL_DOMAINS")?
    .Split(",", StringSplitOptions.RemoveEmptyEntries)
    .Select(d => d.Trim())
    .Where(d => !string.IsNullOrWhiteSpace(d));
config.PrivateEmailDomains = privateEmailDomains?.ToList() ?? new List<string>();

var hiddenPrivateEmailDomains = Environment.GetEnvironmentVariable("HIDDEN_PRIVATE_EMAIL_DOMAINS")?
    .Split(",", StringSplitOptions.RemoveEmptyEntries)
    .Select(d => d.Trim())
    .Where(d => !string.IsNullOrWhiteSpace(d));
config.HiddenPrivateEmailDomains = hiddenPrivateEmailDomains?.ToList() ?? new List<string>();

var ipLoggingEnabled = Environment.GetEnvironmentVariable("IP_LOGGING_ENABLED") ?? "false";
config.IpLoggingEnabled = bool.Parse(ipLoggingEnabled);

builder.Services.AddSingleton(config);
builder.Services.AddSingleton<SharedConfig>(sp => sp.GetRequiredService<Config>());

builder.Services.ConfigureLogging(builder.Configuration, Assembly.GetExecutingAssembly().GetName().Name!, "../../logs");

builder.Services.AddAliasVaultDatabaseConfiguration(builder.Configuration);
builder.Services.AddAliasVaultDataProtection("AliasVault.Api");
builder.Services.AddSingleton<ITimeProvider, SystemTimeProvider>();
builder.Services.AddScoped<TimeValidationJwtBearerEvents>();
builder.Services.AddScoped<AuthLoggingService>();
builder.Services.AddScoped<ServerSettingsService>();
builder.Services.AddHttpContextAccessor();

builder.Services.AddLogging(logging =>
{
    logging.AddConsole();
    logging.SetMinimumLevel(LogLevel.Error);
    logging.AddFilter("Microsoft.AspNetCore.Identity.DataProtectorTokenProvider", LogLevel.Error);
    logging.AddFilter("Microsoft.AspNetCore.Identity.UserManager", LogLevel.Error);
});

builder.Services.AddIdentity<AliasVaultUser, AliasVaultRole>(options =>
    {
        options.Password.RequireDigit = false;
        options.Password.RequireLowercase = false;
        options.Password.RequireNonAlphanumeric = false;
        options.Password.RequireUppercase = false;
        options.Password.RequiredLength = 8;
        options.Password.RequiredUniqueChars = 0;
        options.SignIn.RequireConfirmedAccount = false;
        options.Lockout.MaxFailedAccessAttempts = 10;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(30);
        options.Tokens.ProviderMap.Add("AliasVault", new TokenProviderDescriptor(typeof(DataProtectorTokenProvider<AliasVaultUser>)));
    })
    .AddEntityFrameworkStores<AliasServerDbContext>()
    .AddDefaultTokenProviders()
    .AddTokenProvider<DataProtectorTokenProvider<AliasVaultUser>>("AliasVault");

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
}).AddJwtBearer(options =>
{
    var jwtKey = SecretReader.GetJwtKey();

    options.IncludeErrorDetails = true;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        RequireExpirationTime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = builder.Configuration["Jwt:Issuer"],
        ValidAudience = builder.Configuration["Jwt:Issuer"],
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
        ClockSkew = TimeSpan.Zero,
    };

    // Add custom event handler for validating token expiration time in order
    // to be able to mutate current time for testing the token expiration logic in unit tests.
    options.EventsType = typeof(TimeValidationJwtBearerEvents);
});

// Configure CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy(
        "CorsPolicy",
        policy => policy.AllowAnyOrigin()
            .AllowAnyMethod()
            .AllowAnyHeader());
});

builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        // Ensure consistent date formatting regardless of server locale
        options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.JsonSerializerOptions.WriteIndented = false;
    });
builder.Services.AddMemoryCache();

builder.Services.AddApiVersioning(options =>
    {
        options.DefaultApiVersion = new ApiVersion(1, 0);
        options.AssumeDefaultVersionWhenUnspecified = true;
        options.ReportApiVersions = true;
    })
    .AddApiExplorer(options =>
    {
        options.GroupNameFormat = "'v'VVV";
        options.SubstituteApiVersionInUrl = true;
    });
builder.Services.AddEndpointsApiExplorer();

builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "AliasVault API", Version = "v1" });

    // Add JWT Authentication
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        In = ParameterLocation.Header,
        Description = "Please enter a valid token",
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        BearerFormat = "JWT",
        Scheme = "Bearer",
    });
    c.AddSecurityRequirement(_ => new OpenApiSecurityRequirement
    {
        [new OpenApiSecuritySchemeReference("Bearer")] = [],
    });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("CorsPolicy");

// If the ASPNETCORE_PATHBASE environment variable is set, use it as the path base
if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ASPNETCORE_PATHBASE")))
{
    app.UsePathBase(Environment.GetEnvironmentVariable("ASPNETCORE_PATHBASE"));
}

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

using (var scope = app.Services.CreateScope())
{
    var container = scope.ServiceProvider;
    await using var db = await container.GetRequiredService<IAliasServerDbContextFactory>().CreateDbContextAsync();
    await db.Database.MigrateAsync();
}

await app.RunAsync();

namespace AliasVault.Api
{
    /// <summary>
    /// Explicit program class definition. This is required in order to start the WebAPI project
    /// in-memory from E2ETests project via WebApplicationFactory.
    /// </summary>
    public partial class Program
    {
    }
}
