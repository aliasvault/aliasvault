import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { WalletProvider } from '../context/WalletContext';
import { WalletConnect } from '../components/WalletConnect';
import { generateGuardianKeys, loadGuardianKeys, hasStoredKeys } from '../services/guardianKeyService';
import type { GuardianKeys } from '../types/recovery';

function SetupContent() {
  const { contractAddress } = useParams<{ contractAddress: string }>();
  const [keys, setKeys] = useState<GuardianKeys | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    if (!contractAddress) return;
    if (hasStoredKeys(contractAddress)) {
      setKeys(loadGuardianKeys(contractAddress));
    }
  }, [contractAddress]);

  if (!contractAddress) {
    return <p>Missing contract address in URL.</p>;
  }

  async function handleGenerate() {
    if (keys) {
      const confirmed = window.confirm(
        'Regenerating keys will invalidate your existing on-chain commitment. Continue?',
      );
      if (!confirmed) return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const generated = await generateGuardianKeys(contractAddress!);
      setKeys(generated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate keys');
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyToClipboard(text: string, field: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setCopyError(null);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      setCopyError(field);
      setTimeout(() => setCopyError(null), 3000);
    }
  }

  return (
    <div>
      <h1>Guardian Setup</h1>
      <p>Contract: <code>{contractAddress}</code></p>

      <WalletConnect />

      {keys ? (
        <div data-testid="keys-display">
          <h2>Your Guardian Keys</h2>
          <p>Share the following with the vault owner:</p>

          <div>
            <h3>Guardian Commitment</h3>
            <code data-testid="commitment-display">{keys.commitment}</code>
            <button onClick={() => copyToClipboard(keys.commitment, 'commitment')}>
              {copyError === 'commitment' ? 'Copy failed' : copiedField === 'commitment' ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <div>
            <h3>RSA Public Key (JWK)</h3>
            <pre data-testid="public-key-display">{JSON.stringify(keys.rsaPublicKey, null, 2)}</pre>
            <button onClick={() => copyToClipboard(JSON.stringify(keys.rsaPublicKey), 'publicKey')}>
              {copyError === 'publicKey' ? 'Copy failed' : copiedField === 'publicKey' ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <p>
            <button onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? 'Regenerating...' : 'Regenerate Keys'}
            </button>
          </p>
        </div>
      ) : (
        <div data-testid="generate-prompt">
          <p>No guardian keys found for this contract. Generate your keys to get started.</p>
          <button onClick={handleGenerate} disabled={isGenerating} data-testid="generate-button">
            {isGenerating ? 'Generating...' : 'Generate Guardian Keys'}
          </button>
        </div>
      )}

      {error && <p data-testid="setup-error">{error}</p>}
    </div>
  );
}

export function SetupPage() {
  return (
    <WalletProvider>
      <SetupContent />
    </WalletProvider>
  );
}
