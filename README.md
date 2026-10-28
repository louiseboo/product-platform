# 产品平台

**[打开产品平台](https://louise-ai-d2gi63mlafa5599c4-1434918374.tcloudbaseapp.com/food-product-hub/)** · 项目管理 / 产品测试 / 产品研发

原 GitHub 仓库 `site` 已更名为 `product-platform`，中文名称为“产品平台”。

本仓库保留 CategoryLab 与供应商相关基础源码及历史版本，默认分支为 `tencent-active`。新版三合一平台的源码在独立的 `food-product-hub` 项目维护；线上入口部署在腾讯云 CloudBase。

## 入口

- [产品平台（新版三合一）](https://louise-ai-d2gi63mlafa5599c4-1434918374.tcloudbaseapp.com/food-product-hub/)
- [产品信息提交表](https://louise-ai-d2gi63mlafa5599c4-1434918374.tcloudbaseapp.com/decks/category-lab/supplier-submit)
- [产品测试](https://louise-ai-d2gi63mlafa5599c4-1434918374.tcloudbaseapp.com/food-product-hub/testing/)

## 本仓库保留的基础源码

| 路径 | 作用 |
| --- | --- |
| `decks/category-lab/categorylab.html` | CategoryLab 主应用，包含档期管理与产品日历 |
| `decks/category-lab/supplier-submit.html` | 供应商提交表 |
| `decks/category-lab/supplier-submissions-admin.html` | 产品信息收件箱 |
| `decks/category-lab/cloudbase-config.js` | 腾讯云前端公开配置 |
| `cloudbase/functions/` | 云函数与档期邮件提醒 |
| `tests/` | CategoryLab 回归与交互测试 |
| `docs/superpowers/specs/` | 已确认的模块设计说明 |
| `docs/superpowers/plans/` | 对应实现计划与验收点 |

## 原 CategoryLab 档期模块边界

- 档期是时间轴父对象，食品是档期下的子对象。
- Coffee Bar 全流程属于具体食品，不属于档期汇总行。
- 档期时间轴上层显示计划节点，下层只显示已填写的实际节点。
- 档期保留 7 个汇总节点；食品重点跟踪众测、NPC、中试和大生产。
- 蛋糕默认记录稳定性测试、中试、运输测试和大生产。
- 烘焙/三明治默认记录稳定性测试、中试、烤箱测试和大生产，运输测试按需添加。
- 中试和大生产支持多次记录；当前时间轴取最后一次有日期的实际完成时间。
- 档期、食品、Coffee Bar 流程和产品日历必须联动，食品只录入一次。

## 原 CategoryLab 数据注意事项

以下描述原 CategoryLab 的存储逻辑；新版三合一的数据关系以独立项目 `food-product-hub` 的交接说明为准。

原 CategoryLab 主业务数据主要保存在浏览器 `localStorage`，核心键为 `burger-bom-tool-v1`。代码公开不等于 Louise 浏览器里的数据会自动同步给其他人。

接手开发前必须先在正式页面点击“备份数据 JSON”，再在本地预览中导入验证。飞书数据只用于补齐缺失默认值，不得覆盖 Louise 已经在网页端填写的名称、档期、品类、备注、计划日期、实际日期或食品变更。

腾讯云只保存供应商收件箱数据，以及用于邮件提醒的最小档期节点快照；它目前不是完整 CategoryLab 数据库。

## 本地预览

```bash
git clone https://github.com/louiseboo/product-platform.git
cd product-platform
git switch tencent-active
python3 -m http.server 4173
```

打开：

```text
http://127.0.0.1:4173/decks/category-lab/categorylab.html
```

## 原 CategoryLab 发布规则（历史维护）

以下流程用于本仓库的历史源码维护。新版三合一平台的构建与发布使用独立 `food-product-hub` 项目的流程。

1. 修改 `tencent-active`，不要把腾讯正式线直接合并到保留旧 Vercel 版本的 `main`。
2. 完成档期、日历和提醒测试，并检查桌面/平板排版。
3. 同步主 HTML 到工作台目录：

```text
/Users/louise.lu/Documents/Louise-peet's workstream/12 Category Lab System｜品类工作台迭代/categorylab.html
```

4. 提交并推送 GitHub。
5. 部署腾讯云：

```bash
npx -y --package=@cloudbase/cli@3.6.4 tcb hosting deploy decks/category-lab /decks/category-lab -e louise-ai-d2gi63mlafa5599c4 --retry-count 3
```

6. 核对线上 HTML 与仓库 HTML 的 SHA-256，并确认 Louise 网页端已有数据没有被默认数据覆盖。

凭据、管理口令、QQ SMTP 授权码和云函数环境变量不得写入 GitHub。
