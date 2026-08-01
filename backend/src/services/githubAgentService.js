const { exec } = require('child_process');
const path = require('path');

class GithubAgentService {
  executeCommand(command, cwd = process.cwd()) {
    return new Promise((resolve) => {
      exec(command, { cwd }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, exitCode: error.code, output: stderr || error.message });
        } else {
          resolve({ success: true, exitCode: 0, output: stdout || 'Command executed successfully' });
        }
      });
    });
  }

  async runProjectAnalysis(projectPath = process.cwd()) {
    console.log(`🐙 Running GitHub Code Analysis in: ${projectPath}`);
    const results = {};

    // 1. Git Status & Branch Check
    results.gitStatus = await this.executeCommand('git status --short', projectPath);
    results.gitBranch = await this.executeCommand('git branch --show-current', projectPath);

    // 2. Syntax & Lint Check (if package.json exists)
    results.lintCheck = await this.executeCommand('npm run lint --if-present', projectPath);

    // 3. Build Check (if package.json exists)
    results.buildCheck = await this.executeCommand('npm run build --if-present', projectPath);

    return {
      success: true,
      projectPath,
      analysis: {
        branch: (results.gitBranch.output || 'main').trim(),
        hasUncommittedChanges: !!results.gitStatus.output.trim(),
        buildStatus: results.buildCheck.success ? 'PASSED' : 'FAILED',
        details: results
      }
    };
  }

  async commitAndPush(message = 'Auto-update via AI Executive Agent', projectPath = process.cwd()) {
    const addRes = await this.executeCommand('git add .', projectPath);
    if (!addRes.success) return addRes;

    const commitRes = await this.executeCommand(`git commit -m "${message}"`, projectPath);
    if (!commitRes.success) return commitRes;

    const pushRes = await this.executeCommand('git push', projectPath);
    return pushRes;
  }
}

module.exports = new GithubAgentService();
