const fs = require('fs');
const path = require('path');

const certPath = path.join(__dirname, '../../../certs');
const cert = fs.readFileSync(path.join(certPath, 'localhost+4.pem'));
const key = fs.readFileSync(path.join(certPath, 'localhost+4-key.pem'));

module.exports = {
  '/api': {
    target: 'https://localhost:3443',
    secure: false,
    logLevel: 'debug',
    changeOrigin: true,
    agent: false,
    headers: {
      host: 'localhost:3443'
    },
    ssl: {
      key,
      cert,
      rejectUnauthorized: false,
      requestCert: false,
      checkServerIdentity: () => undefined
    }
  },
  // Add SSL configuration for the dev server
  ssl: {
    key,
    cert
  },
  // Enable HTTPS for the dev server
  protocol: 'https'
}; 