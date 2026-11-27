# 角色协作工作流

通过设计者、总分配者、工作者和独立审查者协作完成任务，支持在共享名额内分层拆分、并行执行与审查返工。

当前 skill 版本：`1.1.0`。

- [技能入口](.agents/skills/role-team/SKILL.md)
- [设计文档](角色协作Skill_设计文档.md)
- [流程图渲染脚本](.agents/skills/role-team/scripts/render-flowcharts.cjs)

![设计流程图](流程图/设计流程图.png)

## 运行产物

调用 `$role-team 任务描述` 后，协作过程数据集中保存在本次工程内：

```text
<工程根目录>/role-team-output/<起始时间与时区_任务名>/v001/
```

例如目录时间格式为 `20261127T153000+0800_任务名`。设计文档、流程／分工／讨论图及图源、任务表和审查记录放在当前版本目录。`流程记录.md` 保存任务与运行ID、产物版本、skill 版本、带时区的创建／更新时间、状态和产物索引；图注与交付也标明版本和时间。

同次运行的进度更新与中断恢复沿用当前未完成版本；已交付成果再修订时新增 `v002` 等，保留旧版。业务代码、正式工程文件及用户指定交付路径仍按工程约定存放，并在记录中引用。

## 渲染流程图

运行下面的命令生成 SVG；末尾添加 PNG 路径可同时导出 PNG：

```sh
node .agents/skills/role-team/scripts/render-flowcharts.cjs input.json output.svg [output.png]
```

SVG 无需安装额外依赖。PNG 需要宿主已有的 Playwright 和浏览器，可通过 PLAYWRIGHT_MODULE_PATH 和 EDGE_EXECUTABLE_PATH 指定路径。

示例输入见 [设计流程图.json](流程图/设计流程图.json) 和 [renderer-smoke.json](流程图/renderer-smoke.json)。
