# Changesets

이 폴더는 [Changesets](https://github.com/changesets/changesets)이 관리합니다.

## 사용법

### 변경사항 기록
```bash
pnpm changeset
```
프롬프트에 따라 bump 타입(major/minor/patch)과 변경 내용을 입력합니다.

### 버전 업데이트 (로컬)
```bash
pnpm changeset version
```

### npm 배포
```bash
pnpm build
pnpm changeset publish
```

PR을 main에 머지하면 GitHub Actions가 자동으로 "Release PR"을 생성합니다.
Release PR을 머지하면 npm에 자동 배포됩니다.
