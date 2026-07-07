<footer class="footer mono">
  <div class="footer-inner">
    <div class="f-col">
      <span class="dim">© 2026</span>
      <span>Flareshare</span>
      <span class="dim">— personal file transfer</span>
    </div>
  </div>
</footer>

<style>
  .footer {
    border-top: 1px solid var(--hairline);
    padding: 18px 0;
    margin-top: auto;
  }
  .footer-inner {
    max-width: 1180px;
    margin: 0 auto;
    padding: 0 32px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11.5px;
    color: var(--muted);
    gap: 16px;
    flex-wrap: wrap;
  }
  .f-col {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  @media (max-width: 760px) {
    .footer-inner {
      padding: 0 18px;
    }
  }
</style>
