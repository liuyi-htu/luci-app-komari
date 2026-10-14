# luci-app-komari

为 OpenWrt / ImmortalWrt 提供 Komari 服务端、Web 面板及 Agent 的 LuCI 管理界面。项目结构参考 frp LuCI 管理项目。

上游：[Komari](https://github.com/komari-monitor/komari)、[Komari Agent](https://github.com/komari-monitor/komari-agent)。

固定版本：**2.0.0 + r1**（OpenWrt 软件包命名为 `2.0.0-r1`）。后续修改保持该版本，除非用户明确要求变更。LuCI 菜单位于 **服务 → Komari**，页面内提供 **Agent / 服务端 / 日志 / 更新核心** 四个标签，默认打开 Agent；更新核心的服务选择也按 Agent、服务端排列。提示弹窗的“关闭”按钮仅关闭弹窗，不刷新页面。

## 功能

- 查看服务状态、核心版本，启动/停止服务，切换开机自启。
- 配置监听地址、端口和持久化数据目录，单独保存配置。
- 打开 Komari 自带的 Web 面板，首次启动后在面板完成初始化和管理员设置。
- 在线安装或升级官方核心，也可上传 Linux 可执行文件或包含核心的 tar.gz。
- 比较核心版本，仅安装更新版本；校验 ELF 格式、运行兼容性和官方发布 API 提供的 SHA256。
- 查看或清空独立日志文件，轮转容量沿用 OpenWrt 系统日志设置。
- 提供英文主包和可选简体中文语言包，采用独立翻译上下文。

运行中的状态与操作区位于四个入口上方；停止后移到入口下方、配置表单上方。服务端停止时隐藏面板入口。Agent 不提供安装目录、服务名称、指定版本、GitHub 代理和 GPU 监控等选项。

与 frp 项目一致，配置保存和核心更新要求先停止服务。更新通过同一文件系统中的临时文件原子替换核心，完成后手动启动；数据目录不随核心更新删除。服务在安装核心后手动启动；开机自启可在 LuCI 中切换。服务端包含上游 Web 面板，LuCI 负责管理其运行与安装；节点、账户、主题等业务设置在 Komari 面板中管理。

## Agent 接入端

Agent 是独立的 `/usr/bin/komari-agent` 二进制，主包提供其管理功能。在「服务 → Komari → Agent」中可在线安装、升级或本地上传核心，配置面板 URL、节点 Token、采集间隔、网卡和挂载点筛选、缓冲区内存、从网卡取 IP 和网络统计月重置日，查看日志，并独立控制启停和开机自启。服务端和 Agent 可同时运行，也可只运行其中一个。

在目标面板新增节点，复制该节点的 Token，填入 Agent 页面并保存，然后启动 Agent。本机面板地址可用 `http://127.0.0.1:25774`；外部面板填写其完整 HTTP/HTTPS 地址。网卡名称用逗号分隔，挂载点用分号分隔。Agent 的初始配置为空，不会自动接入任何面板。远程控制默认禁用，TLS 证书校验默认开启；核心自动更新由 LuCI 的更新入口管理。

Agent 配置位于 `/etc/config/komari_agent`，临时文件位于 `/tmp/komari-agent`。配置文件权限为 0600，Token 通过进程环境传递。Agent 更新和配置保存仅要求 Agent 停止。

上游：[komari-monitor/komari-agent](https://github.com/komari-monitor/komari-agent)。当前核对的 Agent 版本为 `1.5.11`，官方 Linux 发布资产支持 amd64、arm64、386、arm、loong64；在线安装仍以实际发布资产为准。

## 文件和数据

| 路径 | 用途 |
| --- | --- |
| `/etc/config/komari` | 持久化 UCI 设置 |
| `/usr/bin/komari` | 官方服务端核心 |
| `/etc/komari` | 默认工作目录，可改为挂载存储路径 |
| `<数据目录>/data/komari.db` | SQLite 数据库 |
| `/tmp/komari` | 临时上传、更新状态和锁 |

默认监听 `0.0.0.0:25774`。数据目录还包含上游生成的主题及其他文件；修改目录不会迁移原有数据，卸载 LuCI 包也不会主动删除这些文件。长期监控产生持续数据库写入，可将数据目录设置为外置存储。更换数据目录后请自行备份或迁移整个目录。

管理包不捆绑架构相关核心。安装包后，在 LuCI 中在线安装或上传核心，再启动服务。在线更新根据官方发布资产选择 `amd64`、`arm64`、`386`、`riscv64` 或 `loong64`；没有匹配资产的架构会报错，不会下载其他架构文件。当前核对的官方版本为 `1.5.1`，提供 amd64、arm64、386、riscv64、loong64 Linux 核心，没有提供 ARM32/MIPS 核心。

## 安装

APK 系统：

```sh
apk add --allow-untrusted luci-app-komari-2.0.0-r1.apk
# 可选：简体中文
apk add --allow-untrusted luci-i18n-komari-zh-cn-2.0.0-r1.apk
```

IPK 系统：

```sh
opkg install luci-app-komari_2.0.0-r1_all.ipk
# 可选：简体中文
opkg install luci-i18n-komari-zh-cn_2.0.0-r1_all.ipk
```

依赖：`luci-base`、`jsonfilter`、`uclient-fetch`、`ca-bundle`、`coreutils-timeout`。软件包管理器从已配置的软件源安装依赖。语言包安装后将 LuCI 语言设为中文并刷新页面。固件升级前，应另行备份数据目录和自行安装的核心。

## 编译进固件或 SDK

将本目录放入匹配的 OpenWrt/ImmortalWrt 源码或 SDK 的 `package/luci-app-komari`：

```sh
make menuconfig
make package/luci-app-komari/compile V=s
```

## 本地双格式构建

准备好 SDK 模板后运行：

```sh
./build.sh
```

脚本为每套 SDK 创建独立构建副本，不修改模板。通过 `KOMARI_SDK_TEMPLATES` 指定模板目录，包含以下子目录：

- `immortalwrt-sdk-25.12.1-mediatek-filogic`：APK。
- `immortalwrt-sdk-24.10.4-x86-64_gcc-13.3.0_musl.Linux-x86_64`：IPK。
- `host-tools/bin/`：包含 `jsmin`、`install`。

例如：

```sh
KOMARI_SDK_TEMPLATES=/path/to/sdk-templates KOMARI_BUILD_JOBS=2 ./build.sh
```

未设置变量时，脚本使用本工作区相邻 `luci-app-campus-connect/.toolchains` 目录。`KOMARI_BUILD_JOBS` 设置并发数。安装包为架构无关的 `all` / `noarch` 管理包，核心需与目标设备匹配。

产物、语言包和 SHA256 文件位于 `dist/`（不按格式分子目录）；构建日志和验证结果位于 `.build-logs/`。构建过程检查脚本语法、运行权限、配置校验、核心上传与版本保护、只读访问限制、软件包内容、依赖以及 LuCI 实际中文目录查找。

## 验证

```sh
python3 tests/backend-test.py
python3 tests/agent-test.py
python3 tests/log-test.py
python3 tests/version-cache-test.py
python3 tests/firmware-autostart-test.py
node tests/i18n-test.cjs
node tests/frontend-test.cjs
node tests/log-loading-test.cjs
```

测试需要 Python 3、Node.js、BusyBox 和 C 编译器。双格式构建会先运行上述检查，再检查软件包内容、脚本权限和编译后的中文翻译。服务端 1.5.1、Agent 1.5.11 核心已在 ImmortalWrt 25.12.1 ARM64 设备上安装验证。

## 许可证

本项目采用 [Apache-2.0](LICENSE) 许可证；下载的 Komari 服务端和 Agent 核心遵循各自上游的 MIT 许可证。


## 系统日志

四个日志文件位于 `/var/log/komari/`：`server.log`、`agent.log`、`server-update.log`、`agent-update.log`。点击日志标签后才读取日志；再次点击、切换日志文件或手动刷新时重新读取。清空按钮直接截断所选文件。

服务输出由 procd 转交 logd，系统自带的 `logread` 按服务标签写入独立文件，沿用 `system.log_size` 进行原生轮转（保留 `.old`）。服务停止或更新结束时，对应文件写入进程退出。应用不提供日志等级或大小配置，不修改系统设置。该目录通常位于内存，重启后日志不保留。

状态查询使用按核心文件元数据失效的版本缓存；首次检测在后台执行，不阻塞页面载入或状态轮询。

## 编译进固件后的开机自启

与 frp 项目一样，`uci-defaults` 会在软件包安装及固件首次启动时执行 `/etc/init.d/komari enable` 和 `/etc/init.d/komari-agent enable`，注册两个服务的启动项。初始化脚本只注册启动项，不直接启动服务，也不覆盖已有配置。

两个默认配置的 `main.enabled` 仍为 `0`。需要固件开机直接运行时，在固件的 `files/etc/config/komari` 或 `files/etc/config/komari_agent` 中预置 `option enabled '1'`，并将对应核心放入 `files/usr/bin/komari` 或 `files/usr/bin/komari-agent`（权限 0755）。Agent 同时需要有效的 `endpoint` 和 `token`。之后可以在 LuCI 中分别关闭开机自启。
