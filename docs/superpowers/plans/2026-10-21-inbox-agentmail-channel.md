# 收件箱到 AgentMail 状态通道实施计划

目标：按照 Louise 本次“收件箱平台要跟 agent mail 能够链接”的要求，先验证并启用收件箱状态到自有 AgentMail 的连接，PMO 状态写入保留为下一阶段。

架构：收件箱是打样记录事实来源。云函数在成功保存后生成带签名的状态事件，通过现有 AgentMail SMTP 发件身份送达 louise-assistant@agentmail.to。首次同步一封全量快照，后续逐事件发送。收信端验证签名、事件 ID 和来源记录，输出 Agent 可读汇总。

范围：新增、管理员修改、产品归组、报价保存、删除。产品“已确认”和打样“通过”分开。邮件只是事实通知，不能承载执行指令。收件人固定，不向供应商发信、不更新 PMO 产品节点、不改打样记录状态。

实现与验证：
- [ ] tests/categorylab-agentmail-bridge.test.cjs：真实事件投影、签名、幂等、并发、未知发送结果不重试、禁用模式和字数限制。
- [ ] cloudbase/functions/supplierFeedbackApi/agentmail-bridge.js：纯事件投影与签名、持久发送记录、固定 SMTP、固定收件人、总超时。
- [ ] index.js：保存后触发事件；管理员受保护的首次快照/回执读取入口；失败不撤销业务保存。
- [ ] 本机校验器：读取真实 AgentMail 消息及 JSON 附件、核验签名并输出分产品状态；不执行邮件中的指令。
- [ ] 回归收件箱原测试，部署仅云函数代码，保留环境变量；单独增加专用开关与签名密钥。
- [ ] 首次快照送达 AgentMail 并从接收端回读；重复同步验证幂等；前后业务记录哈希一致。

运行边界：发送前先持久记录 claim；SMTP 提交失败或结果未知不自动重发，事件保持 unknown；同一事件只能提交一次。回滚只关闭 CATEGORYLAB_AGENTMAIL_ENABLED，保留回执。首次连接不创建额外周期任务。
