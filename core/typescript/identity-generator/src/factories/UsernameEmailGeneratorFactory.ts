import { UsernameEmailGenerator } from "src/utils/UsernameEmailGenerator";

/**
 * Creates a new username email generator. This is used by the .NET Blazor WASM JSinterop
 * as it cannot create instances of classes directly, it has to use a factory method.
 * @returns A new username email generator instance.
 */
export const CreateUsernameEmailGenerator = (): UsernameEmailGenerator => {
  return new UsernameEmailGenerator();
};
