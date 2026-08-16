#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
server_dir="$(cd "${script_dir}/.." && pwd)"
data_dir="${server_dir}/data"
archive_file="${data_dir}/ecdict-sqlite-28.zip"
target_file="${data_dir}/ecdict.sqlite"
download_url="https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip"

mkdir -p "${data_dir}"
if [[ -f "${target_file}" && "${1:-}" != "--force" ]]; then
  echo "ECDICT 已存在：${target_file}"
  echo "如需重新安装，请运行 npm run setup:ecdict -- --force"
  exit 0
fi

unpack_dir="$(mktemp -d "${data_dir}/ecdict-unpack.XXXXXX")"
cleanup() {
  rm -rf "${unpack_dir}"
}
trap cleanup EXIT

echo "下载 ECDICT 1.0.28 SQLite（约 217 MB）..."
curl --http1.1 --fail --location --retry 3 --continue-at - \
  --output "${archive_file}" "${download_url}"
unzip -q -o "${archive_file}" -d "${unpack_dir}"

source_file="$(find "${unpack_dir}" -type f \( -name '*.db' -o -name '*.sqlite' \) -print -quit)"
if [[ -z "${source_file}" ]]; then
  echo "安装失败：压缩包内未找到 SQLite 数据库。" >&2
  exit 1
fi

mv -f "${source_file}" "${target_file}"
rm -f "${archive_file}"
echo "ECDICT 安装完成：${target_file}"
