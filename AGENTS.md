# ForgeCut agent instructions

- Be minimalistic. Keep code only when it is needed in production or maintained tests.
- Prototypes and feasibility experiments are not production code. Remove them before merging to `dev`, keeping useful findings in architecture decisions and plans.
- Retained tests must exercise production behaviour or a supported integration, rather than a discarded prototype.
- Follow `CLAUDE.md` for architecture, Yarn commands and delivery conventions. Deliver changes through a feature branch and PR. Never merge into `dev` unless the user explicitly instructs it.
