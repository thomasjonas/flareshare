<header class="topbar">
  <div class="topbar-inner">
    <a
      class="wordmark"
      href="/upload"
      aria-label="Flareshare home"
    >
      <span class="wm-dot"></span>
      <span class="wm-text">Flareshare</span>
    </a>
    <span></span>
    <div class="topright">
      <form
        method="POST"
        action="/auth/logout"
      >
        <button
          type="submit"
          class="logout">Sign out</button
        >
      </form>
    </div>
  </div>
</header>

<style>
  .topbar {
    position: sticky;
    top: 0;
    z-index: 10;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: saturate(140%) blur(8px);
    border-bottom: 1px solid var(--hairline);
  }
  .topbar-inner {
    max-width: 1180px;
    margin: 0 auto;
    padding: 14px 32px;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 24px;
  }
  .wordmark {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    font-size: 15px;
    letter-spacing: -0.02em;
    font-weight: 600;
  }
  .wm-dot {
    width: 9px;
    height: 9px;
    background: var(--ink);
    border-radius: 50%;
    display: inline-block;
  }
  .wm-text {
    font-feature-settings: 'ss01';
  }
  .topright {
    justify-self: end;
    font-size: 12px;
    color: var(--muted);
    display: inline-flex;
    align-items: center;
    gap: 14px;
    letter-spacing: 0.01em;
  }
  .logout {
    font-size: 12px;
    color: var(--muted);
    letter-spacing: 0.01em;
    transition: color 0.12s;
  }
  .logout:hover {
    color: var(--ink);
  }

  @media (max-width: 760px) {
    .topbar-inner {
      grid-template-columns: 1fr auto;
      padding: 12px 18px;
    }
  }
</style>
