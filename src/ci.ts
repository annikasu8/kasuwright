/**
 * Stage 11 — CI/CD generation.
 * Emits a Jenkinsfile (the enterprise default) and a GitHub Actions workflow
 * that run the whole chain: BRD pipeline -> generated framework tests ->
 * report -> email, with the HTML report archived as a build artifact.
 */
export function jenkinsfile(): string {
  return `pipeline {
  agent any
  environment {
    BASE_URL = credentials('app-base-url')
    JIRA_BASE_URL = credentials('jira-base-url')
    SMTP_HOST = 'smtp.office365.com'
    REPORT_EMAIL_TO = 'qa-team@company.com'
  }
  stages {
    stage('Checkout') { steps { checkout scm } }
    stage('Install') { steps { sh 'npm ci' } }
    stage('E2E Pipeline: BRD -> Framework') {
      steps { sh 'npx healwright pipeline --brd docs/BRD.md --out runs/latest --project QA' }
    }
    stage('Automation Testing') {
      steps {
        dir('runs/latest/framework') {
          sh 'npm install && npx playwright install --with-deps chromium'
          sh 'npm test'
        }
      }
    }
    stage('Reports') {
      steps {
        archiveArtifacts artifacts: 'runs/latest/report.html, runs/latest/traceability.md', fingerprint: true
        publishHTML(target: [reportName: 'Healwright Report', reportDir: 'runs/latest', reportFiles: 'report.html'])
      }
    }
  }
  post {
    always {
      // Healwright writes report.eml every run; with SMTP_* env set it sends directly.
      echo 'Healwright report generated and emailed (see runs/latest/report.eml if SMTP is not configured).'
    }
    failure {
      echo 'Pipeline failed — auto-defect payloads are in runs/latest/defects.json for Jira import.'
    }
  }
}
`;
}

export function githubActions(): string {
  return `name: Healwright E2E
on: [push, workflow_dispatch]
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - name: BRD -> framework pipeline
        run: npx healwright pipeline --brd docs/BRD.md --out runs/latest --project QA
      - name: Run generated automation suite
        working-directory: runs/latest/framework
        run: |
          npm install
          npx playwright install --with-deps chromium
          npm test
        env:
          BASE_URL: \${{ secrets.APP_BASE_URL }}
      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with: { name: healwright-report, path: runs/latest/report.html }
`;
}
