---
title: "基于战双帕弥什角色的 PBR+NPR 渲染"
date: 2025-04-14
author: "Muxi"
cover: "/images/punishing-raven-npr/render-preview.png"
tags: ["TA", "Rendering", "Unity", "PBR", "NPR"]
excerpt: "一次基于战双帕弥什角色的 Unity URP 渲染尝试，结合 PBR 光照与 NPR 风格化表现，包含脸部 SDF、皮肤 Ramp、描边及动态自发光。"
---

一次基于战双帕弥什角色的 PBR+NPR 渲染尝试。

![战双帕弥什角色的 PBR+NPR 渲染效果](/images/punishing-raven-npr/render-preview.png)

## 开发环境

- **引擎**：Unity
- **渲染管线**：URP 14.0.10
- **渲染路径**：前向渲染（Forward Rendering）

## 核心渲染特性

- **物理基础光照（PBR）**：基于 Albedo、Normal Map 和 PBR Mask（Roughness / Metallic / AO）进行光照计算，采用 Cook-Torrance BRDF 模型。

- **NPR 风格阴影**：集成多级阴影控制（No Shadow、First Shadow、Second Shadow），支持自定义阈值、颜色及平滑过渡（Smooth Shadow），调整卡通渲染的风格化表现。

- **可定制高光**：支持调整高光强度、光泽度（Shininess）、颜色、平滑因子及阴影衰减。

- **边缘光（Rim Light）**：支持边缘光效果控制。

- **环境反射**：支持 Cubemap 环境反射，并可选择性应用旋转。

- **自发光与辉光**：整合自发光（Emission）和辉光（Bloom）效果控制，并支持 Flow Map 驱动的动态自发光。

- **脸部 SDF 渲染**：针对角色脸部使用 SDF（Signed Distance Field）控制明暗表现。

- **专用皮肤着色**：通过 `_SkinRamp` 纹理控制卡通肤色过渡，结合顶点颜色和 Ramp 图进行混合，支持多层皮肤颜色混合。

- **顶点扩展轮廓线**：沿顶点法线扩展（Vertex Extrusion）生成轮廓线，支持宽度和颜色调整、基于距离的宽度缩放及 Z 轴偏移；同时利用顶点颜色的 R 通道控制片元 `discard`，调整轮廓显示。

- **后期处理**：在 `PostProcessing.hlsl` 中实现屏幕空间的曝光、对比度调整，以及基于自定义 LUT 的色彩分级（Color Grading）。

## 演示视频

<video controls playsinline preload="metadata" poster="/images/punishing-raven-npr/render-preview.png" aria-label="战双帕弥什角色 PBR+NPR 渲染演示" style="width: 100%; height: auto; display: block; border-radius: 0.375rem;">
  <source src="/videos/punishing-raven-npr/demo.mp4" type="video/mp4" />
  当前浏览器不支持内嵌视频，可<a href="/videos/punishing-raven-npr/demo.mp4">打开演示视频</a>观看。
</video>

## 未完成部分

- 各向异性发丝高光
- 头发眼透
- 皮肤受光表现
