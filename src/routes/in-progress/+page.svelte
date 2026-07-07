<svelte:head>
  <title>Flareshare — In progress</title>
</svelte:head>

<div class="app">
  <main class="view view-auth">
    <div class="auth-card">
      <div class="auth-mark">
        <span class="wm-dot big"></span>
        <span class="auth-wm">Flareshare</span>
      </div>
      <h2 class="auth-title">Almost ready.</h2>
      <p class="auth-sub">
        This transfer is still being prepared.<br />
        Check back in a moment.
      </p>
    </div>
  </main>
</div>

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--ink);
  }

  .wm-dot {
    width: 9px;
    height: 9px;
    background: var(--ink);
    border-radius: 50%;
    display: inline-block;
  }
  .wm-dot.big {
    width: 14px;
    height: 14px;
  }

  .view {
    max-width: 1180px;
    margin: 0 auto;
    padding: 64px 32px 96px;
    width: 100%;
    flex: 1;
  }
  .view-auth {
    display: flex;
    align-items: center;
    justify-content: center;
    padding-bottom: 96px;
    padding-top: 0px;
  }
  .auth-card {
    width: 100%;
    max-width: 380px;
    text-align: left;
    padding: 24px 0;
  }
  .auth-mark {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 48px;
  }
  .auth-wm {
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .auth-title {
    font-size: 32px;
    line-height: 1.05;
    letter-spacing: -0.035em;
    font-weight: 500;
    margin-bottom: 14px;
    text-wrap: balance;
    /* Distinct from /gone and /try-again: this is a normal, expected state
       (the sender is still adding files), not an error — signal that with
       the accent color instead of the neutral ink tone used elsewhere. */
    color: var(--accent);
  }
  .auth-sub {
    color: var(--muted);
    font-size: 14px;
    margin-bottom: 32px;
    line-height: 1.5;
  }

  @media (max-width: 760px) {
    .view {
      padding: 32px 18px 64px;
    }
  }
</style>
