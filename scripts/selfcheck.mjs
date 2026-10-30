const name = process.argv[2];

if (!name) {
  console.error('用法：pnpm selfcheck <名字>');
  process.exit(1);
}

console.log(`${name} 的真实调用自检尚未接通。当前骨架不会请求任何 AI，也不会读取密钥。`);
