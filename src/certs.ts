import * as forge from "node-forge";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Cert generation for HTTPS interception mode.
 *
 * Gera:
 *  - Root CA self-signed (uma vez, persistido)
 *  - Leaf cert para api.anthropic.com assinado pela CA
 *
 * O usuário precisa instalar a Root CA no trust store do Windows
 * (feito pelo install-https.ps1).
 */

export interface CertBundle {
  caCertPem: string;
  caKeyPem: string;
  leafCertPem: string;
  leafKeyPem: string;
}

const CERT_DIR = path.join(os.homedir(), ".claudesave", "certs");
const CA_CERT_FILE = path.join(CERT_DIR, "ca.crt");
const CA_KEY_FILE  = path.join(CERT_DIR, "ca.key");
const LEAF_CERT_FILE = path.join(CERT_DIR, "leaf.crt");
const LEAF_KEY_FILE  = path.join(CERT_DIR, "leaf.key");

const CA_VALIDITY_YEARS = 10;
const LEAF_VALIDITY_YEARS = 5;

function ensureDir(): void {
  if (!fs.existsSync(CERT_DIR)) {
    fs.mkdirSync(CERT_DIR, { recursive: true });
  }
}

function createCA(): { certPem: string; keyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + CA_VALIDITY_YEARS);

  const attrs = [
    { name: "commonName",         value: "ClaudeSave Local CA" },
    { name: "countryName",        value: "US" },
    { shortName: "ST",            value: "Local" },
    { name: "localityName",       value: "Local" },
    { name: "organizationName",   value: "ClaudeSave" },
    { shortName: "OU",            value: "Local Proxy" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, digitalSignature: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem:  forge.pki.privateKeyToPem(keys.privateKey),
  };
}

function createLeafCert(
  hostname: string,
  caCertPem: string,
  caKeyPem: string
): { certPem: string; keyPem: string } {
  const caCert = forge.pki.certificateFromPem(caCertPem);
  const caKey  = forge.pki.privateKeyFromPem(caKeyPem);

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + LEAF_VALIDITY_YEARS);

  cert.setSubject([
    { name: "commonName", value: hostname },
  ]);
  cert.setIssuer(caCert.subject.attributes);

  cert.setExtensions([
    { name: "basicConstraints", cA: false, critical: true },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true, clientAuth: true },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: hostname },               // DNS
        { type: 2, value: "*." + hostname.split(".").slice(1).join(".") }, // wildcard sibling
      ],
    },
  ]);

  cert.sign(caKey, forge.md.sha256.create());

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem:  forge.pki.privateKeyToPem(keys.privateKey),
  };
}

/**
 * Carrega certs existentes ou gera novos.
 * Retorna o bundle completo (CA + leaf).
 */
export function ensureCerts(hostname = "api.anthropic.com"): CertBundle {
  ensureDir();

  let caCertPem: string;
  let caKeyPem:  string;

  if (fs.existsSync(CA_CERT_FILE) && fs.existsSync(CA_KEY_FILE)) {
    caCertPem = fs.readFileSync(CA_CERT_FILE, "utf8");
    caKeyPem  = fs.readFileSync(CA_KEY_FILE,  "utf8");
  } else {
    console.log("Generating Root CA (one-time)...");
    const ca = createCA();
    fs.writeFileSync(CA_CERT_FILE, ca.certPem);
    fs.writeFileSync(CA_KEY_FILE,  ca.keyPem);
    caCertPem = ca.certPem;
    caKeyPem  = ca.keyPem;
  }

  let leafCertPem: string;
  let leafKeyPem:  string;

  if (fs.existsSync(LEAF_CERT_FILE) && fs.existsSync(LEAF_KEY_FILE)) {
    leafCertPem = fs.readFileSync(LEAF_CERT_FILE, "utf8");
    leafKeyPem  = fs.readFileSync(LEAF_KEY_FILE,  "utf8");
  } else {
    console.log(`Generating leaf cert for ${hostname}...`);
    const leaf = createLeafCert(hostname, caCertPem, caKeyPem);
    fs.writeFileSync(LEAF_CERT_FILE, leaf.certPem);
    fs.writeFileSync(LEAF_KEY_FILE,  leaf.keyPem);
    leafCertPem = leaf.certPem;
    leafKeyPem  = leaf.keyPem;
  }

  return { caCertPem, caKeyPem, leafCertPem, leafKeyPem };
}

export function getCertPaths() {
  return { CA_CERT_FILE, CA_KEY_FILE, LEAF_CERT_FILE, LEAF_KEY_FILE, CERT_DIR };
}
