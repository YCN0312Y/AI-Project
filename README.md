# AI 项目集

这是一个以 AI 辅助开发的个人项目集合，目前包含两个完整项目：一个 Python/Pygame 中国象棋，和一个原生 Canvas 2D 微信小游戏《扩编战争》。

## 项目一览

| 项目 | 技术 | 类型 | 说明 |
| --- | --- | --- | --- |
| [中国象棋](XiangQi/README.md) | Python + Pygame | 桌面棋类游戏 | 完整象棋规则、人机 AI、悔棋、提示、存档、计时 |
| [扩编战争](KuoBianZhanZheng/README.md) | 原生微信小游戏 API + Canvas 2D | 竖屏单机小游戏 | 50 关、编制合成、随机敌军基地、武器与草丛系统 |

---

## 中国象棋

一个功能完整的中国象棋项目，支持本地双人和人机对战。

- 标准 32 子棋盘，完整走法、将死、困毙和照面判定
- 人机 AI：迭代加深 Negamax + Alpha-Beta + 静态搜索，三档难度
- 悔棋、合法落点提示、AI 推荐走法、吃子记录、双方 15 分钟计时
- 存档/读档、程序生成音效、棋子移动动画
- 紫檀木桌面、木纹棋盘和象牙棋子界面

运行：

```bash
cd XiangQi
pip install -r requirements.txt
python main.py
```

更多说明见 [XiangQi/README.md](XiangQi/README.md)。

---

## 扩编战争

一款竖屏单机微信小游戏。你从一个小班起步，拖动部队自动战斗，招募新编制并三合一扩编，从班一路打到方面军，攻下 50 个随机生成的敌军基地。

- 10 级编制：班 / 排 / 连 / 营 / 团 / 旅 / 师 / 军 / 军团 / 方面军
- 3 个同等级我方单位自动合体，兵力相加，可连锁升级
- 50 关逐关推进，敌军基地的房间、走廊、大门和墙体每局随机
- 墙体阻挡移动、子弹和视线；草丛可隐蔽，敌人不能进入草丛
- 机枪、手雷、迫击炮三种限时武器；金币可兑换军功
- 自动存档，每关开场保存快照，战败可回到本关初始状态重试
- 两首原创 BGM，可分别开关背景音乐和战斗音效

微信开发者工具导入：

`KuoBianZhanZheng/Package/KuoBianZhanZheng-WeChat-Game`（正式包，无测试关卡）

开发调试使用：

`KuoBianZhanZheng/Package/KuoBianZhanZheng-Development`（保留测试关卡）

更多说明见 [KuoBianZhanZheng/README.md](KuoBianZhanZheng/README.md)。

---

## 项目结构

```
AIProject/
├─ XiangQi/                 # Python + Pygame 中国象棋
├─ KuoBianZhanZheng/        # 微信小游戏《扩编战争》
│  ├─ js/                   # 游戏源代码
│  ├─ assets/               # 图片与音频
│  ├─ dev/                  # 浏览器预览
│  └─ Package/              # 微信小游戏导入目录
├─ WuZiQi/                  # 其他实验项目
└─ README.md
```

两个项目均为单机运行，不依赖服务器；《扩编战争》使用微信本地存档，中国象棋使用本地 JSON 存档。

## 作者

渝常念 · 反馈/建议：ycn2182651251@gmail.com
