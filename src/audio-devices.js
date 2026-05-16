const { execSync } = require('child_process');
const { isWindows } = require('./platform');

/**
 * List available audio input devices (microphones).
 *
 * @returns {string[]} Array of device names
 */
function listAudioDevices() {
  if (isWindows) {
    return listWindowsAudioDevices();
  }
  return listLinuxAudioDevices();
}

/**
 * List audio input devices on Windows using ffmpeg dshow.
 * Parses: "device_name" (audio)
 */
function listWindowsAudioDevices() {
  try {
    const output = execSync('ffmpeg -list_devices true -f dshow -i dummy 2>&1', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const devices = [];
    // Match lines like: [in#0 @ ...] "Microphone (Realtek Audio)" (audio)
    const regex = /\["([^"]+)"\s*\(audio\)/g;
    let match;
    while ((match = regex.exec(output)) !== null) {
      devices.push(match[1]);
    }

    // Alternative pattern without brackets
    if (devices.length === 0) {
      const regex2 = /"([^"]+)"\s*\(audio\)/g;
      while ((match = regex2.exec(output)) !== null) {
        if (!devices.includes(match[1])) {
          devices.push(match[1]);
        }
      }
    }

    return devices;
  } catch {
    return [];
  }
}

/**
 * List audio input devices on Linux using arecord.
 * Parses: card X: Name [Friendly Name], device Y: Device Name [Device Name]
 */
function listLinuxAudioDevices() {
  try {
    const output = execSync('arecord -l 2>/dev/null', {
      encoding: 'utf-8',
    });

    const devices = [];
    const lines = output.split('\n');
    for (const line of lines) {
      const match = line.match(/card\s+(\d+):\s+(\S+)\s+\[([^\]]+)\]/);
      if (match) {
        const card = match[1];
        const name = match[2];
        const friendly = match[3];
        devices.push(`plughw:${card},0 (${friendly})`);
      }
    }
    return devices;
  } catch {
    return [];
  }
}

/**
 * Prompt user to select a microphone from a list.
 *
 * @param {string[]} devices - Array of device names
 * @param {readline.Interface} rl - readline interface
 * @returns {Promise<string>} Selected device name
 */
async function selectAudioDevice(devices, rl) {
  if (devices.length === 0) {
    console.log('⚠️  未检测到麦克风设备，请检查音频设置');
    return null;
  }

  if (devices.length === 1) {
    console.log(`🎤 检测到麦克风: ${devices[0]}`);
    return devices[0];
  }

  console.log(`\n🎤 检测到 ${devices.length} 个麦克风:`);
  devices.forEach((d, i) => {
    console.log(`  ${i + 1}. ${d}`);
  });
  console.log('');

  const answer = await new Promise((resolve) => {
    rl.question(`请选择麦克风 (1-${devices.length}) [1]: `, (input) => {
      const num = parseInt(input) || 1;
      if (num >= 1 && num <= devices.length) {
        resolve(devices[num - 1]);
      } else {
        resolve(devices[0]);
      }
    });
  });

  return answer;
}

/**
 * Extract the actual device name for ffmpeg input.
 * On Windows, this is the display name.
 * On Linux, this is the ALSA device (hw:X,Y).
 */
function getFfmpegDeviceName(device) {
  if (isWindows) {
    return device;
  }
  // Linux: extract plughw:X,Y from "plughw:X,Y (Friendly Name)"
  const match = device.match(/(plughw:\d+,\d+)/);
  return match ? match[1] : 'plughw:0,0';
}

module.exports = {
  listAudioDevices,
  selectAudioDevice,
  getFfmpegDeviceName,
};
