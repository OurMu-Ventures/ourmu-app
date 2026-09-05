const required = [
  "LEGAL_AGREEMENT_SHA256",
  "LEGAL_PRIVACY_APPROVED_VERSION",
  "LEGAL_RISK_APPROVED_VERSION",
  "RECEIVING_BANK_CONFIRMED",
  "RESEND_DOMAIN_VERIFIED",
];
const missing = required.filter((name) => !process.env[name]);
if (
  process.env.LEGAL_AGREEMENT_SHA256 &&
  !/^[a-f0-9]{64}$/i.test(process.env.LEGAL_AGREEMENT_SHA256)
)
  missing.push("valid LEGAL_AGREEMENT_SHA256");
for (const name of ["RECEIVING_BANK_CONFIRMED", "RESEND_DOMAIN_VERIFIED"])
  if (process.env[name] !== "true") missing.push(`${name}=true`);
if (process.env.AGREEMENT_PLACEHOLDER_BLOCK !== "false")
  missing.push("AGREEMENT_PLACEHOLDER_BLOCK=false");
if (missing.length) {
  console.error(`Release blocked: ${[...new Set(missing)].join(", ")}`);
  process.exit(1);
}
console.log("Production legal and operational gate passed.");
