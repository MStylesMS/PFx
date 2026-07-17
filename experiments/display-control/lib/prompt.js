'use strict';

const readline = require('readline');

/**
 * Interactive stdin helpers for visual-confirmation tests.
 */

function createInterface() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
}

/**
 * Ask a yes/no/skip question. Returns 'y' | 'n' | 's'.
 * Empty input defaults to `defaultAnswer` ('y' | 'n' | 's').
 */
async function askChoice(rl, question, { defaultAnswer = 'y', allowSkip = true } = {}) {
    const opts = allowSkip ? 'y/n/s' : 'y/n';
    const hint = defaultAnswer ? ` [${opts}, default=${defaultAnswer}]` : ` [${opts}]`;
    const answer = await askRaw(rl, `${question}${hint}: `);
    const normalized = (answer.trim().toLowerCase() || defaultAnswer).charAt(0);
    if (normalized === 'y' || normalized === 'n') return normalized;
    if (allowSkip && normalized === 's') return 's';
    console.log(`  Please answer with ${opts}.`);
    return askChoice(rl, question, { defaultAnswer, allowSkip });
}

async function askRaw(rl, prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => resolve(answer));
    });
}

async function pause(rl, message = 'Press Enter to continue...') {
    await askRaw(rl, message);
}

function say(message = '') {
    console.log(message);
}

function heading(title) {
    const line = '='.repeat(Math.min(72, Math.max(24, title.length + 8)));
    console.log(`\n${line}`);
    console.log(`  ${title}`);
    console.log(`${line}\n`);
}

function subheading(title) {
    console.log(`\n--- ${title} ---\n`);
}

module.exports = {
    createInterface,
    askChoice,
    askRaw,
    pause,
    say,
    heading,
    subheading,
};
