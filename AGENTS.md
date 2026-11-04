# Repository instructions

## Reference documents

The user explicitly prohibits pushing GOST documents, books, and their copies anywhere, ever. Keep original publications, scans, OCR text, translations, and extracted full texts outside this checkout, in the local environment only (for example /workspace/research-sources or /workspace/attachments). Never stage, commit, push, attach to a PR, upload as a CI artifact, or otherwise publish those files. Changing the file extension does not make a reference publication eligible for Git. Bibliographic metadata, source URLs, hashes, original engineering derivations and project-authored documentation may be committed. Review the complete staged file list before every commit; .gitignore is only an additional guard.

## Target and validation

Initial development targets Windows 10/11 x64. The product requirements prohibit implementation and testing for other operating systems during the initial development. Do not report tests as passed unless they actually ran. Windows CI has been executed for the initial desktop iteration; see docs/iteration-01.md for exact commits and outcomes. Always check the current commit rather than assuming its checks passed.

## Continuing development

Read docs/development-handoff.md and docs/scope-and-acceptance.md before extending functionality. They preserve the full task context, actual implementation status, evidence, planned stages and acceptance requirements. Never treat an unexecuted Windows workflow as a passed check.

Read docs/desktop-workflow.md and docs/application-contract.md for the implemented desktop and service interfaces. The app never returns normative strength acceptance.
