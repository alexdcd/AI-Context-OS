# Contributing to AI Context OS

First off, thank you for considering contributing to AI Context OS! It's people like you that make this ecosystem tool a reality.

The following is a set of guidelines for contributing to AI Context OS and its packages. These are mostly guidelines, not rules. Use your best judgment, and feel free to propose changes to this document in a pull request.

## Core Project License & CLA

The core `AI-Context-OS` repository is licensed under the **Functional Source License (FSL-1.1-Apache-2.0)**. This license eventually converts to Apache 2.0 after two years.

To ensure that the core can safely transition to the Apache 2.0 license in the future, and to keep the Intellectual Property hygiene intact, we require all contributors to sign a **Contributor License Agreement (CLA)**.

### How the CLA Process Works

1. You fork the repository and make your changes.
2. You open a Pull Request (PR) against the `main` branch.
3. Our automated CLA bot (`cla-assistant.io`) will inspect your PR.
4. If it's your first time contributing, the bot will leave a comment asking you to sign the CLA.
5. Click the link provided by the bot, authenticate with your GitHub account, and accept the agreement.
6. The bot will automatically update the status of your PR to "Passed" and we will review your code!

By signing the CLA, you retain full ownership of your code, while granting us the necessary rights to use, modify, and re-license your contribution as part of the core project.

## Ecosystem: Plugins and Extensions

AI Context OS is designed to be extensible. We believe in an open, vibrant ecosystem of plugins, connectors, and agents.

Because the core project is under the FSL, we want to clarify how plugins work regarding licenses:

- **Creating a plugin does not make it a derivative work of the core system.** You are free to build plugins that interact with the application.
- **Community Plugins:** We highly encourage the community to build and release plugins under the **Apache License 2.0** (or similar permissive open-source licenses). This helps the ecosystem grow and ensures other engineers can benefit from your work.

## How to Contribute Code

1. Check the [Issues](https://github.com/alexdc/AI-Context-OS/issues) tab for existing bugs or feature requests. 
2. If you are proposing a large architectural change, please open a Discussion or an Issue first.
3. Fork the Repo.
4. Create your Feature Branch (`git checkout -b feature/AmazingFeature`).
5. Commit your Changes (see our **Commit Convention** below).
6. Push to the Branch (`git push origin feature/AmazingFeature`).
7. Open a Pull Request following our **Pull Request Guidelines** and sign the CLA!.

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

`<type>(<scope>): <subject>`

`<body>`

`<footer>`

### Types

| Type | Description |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `style` | Code style (no logic change) |
| `refactor` | Code refactoring |
| `perf` | Performance improvement |
| `test` | Tests |
| `chore` | Build/tooling |

### Examples

```bash
# New feature
git commit -m "feat(parser): add support for xlsx files"

# Bug fix
git commit -m "fix(retrieval): fix score calculation in rerank"

# Documentation
git commit -m "docs: update quick start guide"

# Refactoring
git commit -m "refactor(storage): simplify interface methods"
```

## Pull Request Guidelines

### PR Title
Use the same format as commit messages.

### PR Description Template

When creating a PR, please structure your description as follows:

```markdown
## Summary

Brief description of the changes and their purpose.

## Type of Change

- [ ] New feature (feat)
- [ ] Bug fix (fix)
- [ ] Documentation (docs)
- [ ] Refactoring (refactor)
- [ ] Other

## Testing

Describe how to test these changes:
- [ ] Unit tests pass
- [ ] Manual testing completed

## Related Issues

- Fixes #123
- Related to #456

## Checklist

- [ ] Code follows project style guidelines
- [ ] Tests added for new functionality
- [ ] Documentation updated (if needed)
- [ ] All tests pass
```

We look forward to reviewing your PRs!
