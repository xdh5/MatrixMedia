'use strict'

process.env.NODE_ENV = 'development'

const chalk = require('chalk')
const electron = require('electron')
const path = require('path')
const { say } = require('cfonts')
const { spawn } = require('child_process')
const webpack = require('webpack')

const mainConfig = require('./webpack.main.config')

let electronProcess = null
let manualRestart = false

function logStats(proc, data) {
  let log = ''

  log += chalk.yellow.bold(`┏ ${proc} 编译过程 ${new Array((19 - proc.length) + 1).join('-')}`)
  log += '\n\n'

  if (typeof data === 'object') {
    data.toString({
      colors: true,
      chunks: false
    }).split(/\r?\n/).forEach(line => {
      log += '  ' + line + '\n'
    })
  } else {
    log += `  ${data}\n`
  }

  log += '\n' + chalk.yellow.bold(`┗ ${new Array(28 + 1).join('-')}`) + '\n'
  console.log(log)
}

function removeJunk(chunk) {
  if (/\d+-\d+-\d+ \d+:\d+:\d+\.\d+ Electron(?: Helper)?\[\d+:\d+] /.test(chunk)) {
    return false;
  }
  if (/\[\d+:\d+\/|\d+\.\d+:ERROR:CONSOLE\(\d+\)\]/.test(chunk)) {
    return false;
  }
  if (/ALSA lib [a-z]+\.c:\d+:\([a-z_]+\)/.test(chunk)) {
    return false;
  }
  return chunk;
}

function startMain() {
  return new Promise((resolve) => {
    mainConfig.mode = 'development'
    const compiler = webpack(mainConfig)

    compiler.hooks.watchRun.tapAsync('watch-run', (compilation, done) => {
      logStats('主进程', chalk.white.bold('正在处理资源文件...'))
      done()
    })

    compiler.watch({}, (err, stats) => {
      if (err) {
        console.log(err)
        return
      }

      logStats('主进程', stats)

      if (electronProcess && electronProcess.kill) {
        manualRestart = true
        process.kill(electronProcess.pid)
        electronProcess = null
        startElectron()

        setTimeout(() => {
          manualRestart = false
        }, 5000)
      }

      resolve()
    })
  })
}

function startElectron() {
  var args = [
    '--inspect=5858',
    path.join(__dirname, '../dist/electron/main.js')
  ]

  // detect yarn or npm and process commandline args accordingly
  if (process.env.npm_execpath.endsWith('yarn.js')) {
    args = args.concat(process.argv.slice(3))
  } else if (process.env.npm_execpath.endsWith('npm-cli.js')) {
    args = args.concat(process.argv.slice(2))
  }

  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  electronProcess = spawn(electron, args, { env: childEnv })

  electronProcess.stdout.on('data', data => {
    electronLog(removeJunk(data), 'blue')
  })
  electronProcess.stderr.on('data', data => {
    electronLog(removeJunk(data), 'red')
  })

  electronProcess.on('close', () => {
    if (!manualRestart) process.exit()
  })
}

function electronLog(data, color) {
  if (data) {
    let log = ''
    data = data.toString().split(/\r?\n/)
    if(data.length){
      if(data[0].indexOf('Failed to fetch extension') != -1 ) return
    }
    data.forEach(line => {
      log += `  ${line}\n`
    })
    console.log(
      chalk[color].bold('┏ 主程序日志 -------------------') +
      '\n\n' +
      log +
      chalk[color].bold('┗ ----------------------------') +
      '\n'
    )
  }

}

function greeting() {
  const cols = process.stdout.columns
  let text = ''

  if (cols > 104) text = 'electron-vue'
  else if (cols > 76) text = 'electron-|vue'
  else text = false

  if (text) {
    say(text, {
      colors: ['yellow'],
      font: 'simple3d',
      space: false
    })
  } else console.log(chalk.yellow.bold('\n  electron-vue'))
  console.log(chalk.blue('  准备启动...') + '\n')
}

async function init() {
  greeting()

  try {
    await startMain()
    await startElectron()
  } catch (error) {
    console.error(error)
  }

}

init()