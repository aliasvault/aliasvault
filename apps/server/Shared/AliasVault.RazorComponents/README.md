# AliasVault.RazorComponents

This project contains shared Razor components and UI-related functionality used across the AliasVault solution. This project focuses specifically on reusable UI components.

## Purpose

This library provides shared Blazor components used by the admin application:
- Reusable Razor components
- UI-specific services
- Component-related models
- Component-specific utilities

## Project Structure

The project is organized as follows:
- `Components/` - Contains reusable Razor components like Paginator.razor
- `Services/` - UI-specific services used by components
- `Models/` - Component-specific models and DTOs

## Dependencies

This project:
- Is a Razor Class Library targeting browser platform
- Depends on Microsoft.AspNetCore.Components.Web
- Can include UI-specific external dependencies as needed

## Related Projects

- **AliasVault.Shared** - Contains general shared models, DTOs and business logic
- **AliasVault.Shared.Core** - Contains core shared code with no external dependencies
- **AliasVault.RazorComponents** (this project) - Contains shared UI components and Razor-specific code
