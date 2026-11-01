/** An ordinary Worker binding cannot manufacture this native runtime capability. */
export const nativeHosting = Symbol("chargeos-native-https-hosting");
export const signupDelivery = Symbol("chargeos-initial-signup-delivery");
export interface ServiceSettings {
  SERVICE_MODE?: string;
  SERVICE_ORIGIN?: string;
  SERVICE_AUTH_SECRET?: string;
  SERVICE_DELIVERY?: string;
  SERVICE_SIGNUP_DOMAINS?: string;
  [nativeHosting]?: true;
}
export interface ServiceConfiguration {
  origin: string;
  secret: string;
  delivery: "local" | "smtp";
  mode: "local-development" | "self-hosted";
  signupDomains: string[];
}
export function publicServiceOrigin(value: unknown): string | null {
  try {
    if (typeof value !== "string" || value.length > 320) return null;
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.port !== "" ||
      url.origin !== value ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname) ||
      /(?:^|\.)(localhost|local)$/.test(url.hostname)
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
export function localConfiguration(env: ServiceSettings): ServiceConfiguration | null {
  if (
    env.SERVICE_MODE !== "local" ||
    !env.SERVICE_ORIGIN ||
    !env.SERVICE_AUTH_SECRET ||
    env.SERVICE_AUTH_SECRET.length < 32 ||
    env.SERVICE_AUTH_SECRET.length > 4096 ||
    ![undefined, "local", "smtp"].includes(env.SERVICE_DELIVERY)
  )
    return null;
  try {
    const url = new URL(env.SERVICE_ORIGIN);
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.origin !== env.SERVICE_ORIGIN
    )
      return null;
    return {
      origin: url.origin,
      secret: env.SERVICE_AUTH_SECRET,
      delivery: env.SERVICE_DELIVERY === "smtp" ? "smtp" : "local",
      mode: "local-development",
      signupDomains: [],
    };
  } catch {
    return null;
  }
}
export function serviceConfiguration(env: ServiceSettings): ServiceConfiguration | null {
  const local = localConfiguration(env);
  if (local) return local;
  const origin = publicServiceOrigin(env.SERVICE_ORIGIN);
  if (
    env[nativeHosting] !== true ||
    env.SERVICE_MODE !== "production" ||
    !origin ||
    env.SERVICE_DELIVERY !== "smtp" ||
    !env.SERVICE_AUTH_SECRET ||
    env.SERVICE_AUTH_SECRET.length < 32 ||
    env.SERVICE_AUTH_SECRET.length > 4096 ||
    env.SERVICE_AUTH_SECRET.trim() !== env.SERVICE_AUTH_SECRET ||
    /[\0\r\n]/.test(env.SERVICE_AUTH_SECRET) ||
    !env.SERVICE_SIGNUP_DOMAINS
  )
    return null;
  const domains = env.SERVICE_SIGNUP_DOMAINS.split(",");
  if (
    !domains.length ||
    domains.length > 20 ||
    new Set(domains).size !== domains.length ||
    domains.some((domain) => !publicServiceOrigin(`https://${domain}`))
  )
    return null;
  return {
    origin,
    secret: env.SERVICE_AUTH_SECRET,
    delivery: "smtp",
    mode: "self-hosted",
    signupDomains: domains,
  };
}
export function signupEmailAllowed(config: ServiceConfiguration, email: unknown): boolean {
  return (
    config.mode === "local-development" ||
    (typeof email === "string" &&
      config.signupDomains.includes(email.toLowerCase().match(/^[^\s@]+@([^\s@]+)$/)?.[1] ?? ""))
  );
}
