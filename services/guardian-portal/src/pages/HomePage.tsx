export function HomePage() {
  return (
    <div>
      <h1>AliasVault Guardian Portal</h1>
      <p>
        You have been invited to help protect someone's AliasVault. As a guardian, you hold a piece
        of the recovery key that can help the vault owner regain access if they lose their master password.
      </p>

      <h2>What would you like to do?</h2>

      <div>
        <h3>I was invited as a guardian</h3>
        <p>
          Generate your guardian keys and share your commitment with the vault owner.
          You will need the contract address provided by the vault owner.
        </p>
        <p>
          Navigate to: <code>/setup/{'<contract-address>'}</code>
        </p>
      </div>

      <div>
        <h3>I need to approve a recovery</h3>
        <p>
          The vault owner will send you a link containing the recovery request.
          The link looks like: <code>/approve/{'<cid>'}</code>
        </p>
        <p>
          If you received a link from the vault owner, open it directly in your browser.
        </p>
      </div>
    </div>
  );
}
