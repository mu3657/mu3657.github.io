---
title: "《明日方舟：终末地》大气渲染解析（一）：从 T-LUT、MS-LUT 到 Sky-View LUT"
date: 2026-09-03
author: "Muxi"
cover: "/images/hgrp-atmosphere-part1/cover.jpg"
tags: ["Rendering", "Atmosphere", "Reverse Engineering", "HGRP"]
excerpt: "基于《明日方舟：终末地》的一帧 Vulkan RenderDoc 截帧，解析 HGRP 如何连续生成 Transmittance LUT、Multiple-Scattering LUT 与 Sky-View LUT。"
---

本文基于《明日方舟：终末地》的一帧 Vulkan RenderDoc 截帧，分析其中连续生成 Transmittance LUT、Multiple-Scattering LUT 和 Sky-View LUT 的三个 Color Pass。文章会从辐射传输方程出发，还原三张 LUT 的参数化、数据依赖和近似策略，并与 Sébastien Hillaire 的公开方法进行比较。为便于叙述，后文将这套由 Hypergryph 定制的管线简称为 **HGRP**。

本文主要回答四个问题：

- T-LUT 如何把高度和观察方向编码进二维纹理？
- MS-LUT 如何用实时近似补偿二次及更高阶散射？
- Sky-View LUT 如何把前两张表积分成当前视点的天空颜色？
- HGRP 相对 Hillaire 参考实现做了哪些性能与精度取舍？

> **分析边界**：Hypergryph 尚未公开完整管线设计。本文结论来自当前 Vulkan 截帧、资源绑定和 Shader 反编译，只描述当前帧中能够观察到的实现。本文覆盖的三个 Color Pass 也不代表 Hillaire 论文或 HGRP 大气与天气系统的全部功能。

> **AI 辅助说明**：文中的重构代码由 GPT（OpenAI Codex）基于 RenderDoc 截帧、SPIR-V 反编译 GLSL 和资源绑定信息辅助整理，主要涉及变量重命名、控制流还原与注释。它们并非鹰角网络公开的官方源码，语义命名和设计意图可能包含推断。

本文主要参考 Sébastien Hillaire 的论文 [*A Scalable and Production Ready Sky and Atmosphere Rendering Technique*](https://doi.org/10.1111/cgf.14050) 及其公开的 [参考实现](https://github.com/sebh/UnrealEngineSkyAtmosphere)。该方法构成了 UE4 天空大气系统的基础，并在 UE5 中继续发展。

论文算法的主要 HLSL 实现位于 [`RenderSkyRayMarching.hlsl`](https://github.com/sebh/UnrealEngineSkyAtmosphere/blob/master/Resources/RenderSkyRayMarching.hlsl)，LUT 的最终使用方式可参考 [`RenderWithLuts.hlsl`](https://github.com/sebh/UnrealEngineSkyAtmosphere/blob/master/Resources/RenderWithLuts.hlsl)。Unreal Engine 中的生产实现则主要位于 [`SkyAtmosphereRendering.cpp`](https://github.com/EpicGames/UnrealEngine/blob/release/Engine/Source/Runtime/Renderer/Private/SkyAtmosphereRendering.cpp) 与 [`SkyAtmosphere.usf`](https://github.com/EpicGames/UnrealEngine/blob/release/Engine/Shaders/Private/SkyAtmosphere.usf)。

## 三个 Pass 与本文目标

本文按照三个 Color Pass 的依赖顺序，分析实时大气散射如何从“光穿过大气后还剩多少”走到“相机最终看见什么颜色”：

```text
Color Pass #1：Transmittance LUT
        ↓ 为任意位置提供太阳光透射率
Color Pass #2：Multiple-Scattering LUT
        ↓ 为任意位置提供多重散射近似
Color Pass #3：Sky-View LUT
        ↓
后续着色阶段查表，获得相机上半球各个观察方向的天空颜色
```

- **T-LUT**：输入高度和光线天顶角，输出光线穿过大气后的剩余能量。
- **MS-LUT**：读取 T-LUT，输入高度和太阳天顶角，输出该位置的多重散射近似。
- **Sky-View LUT**：读取 T-LUT 与 MS-LUT，结合相机位置、上半球观察方向和太阳方向，输出最终天空亮度。


这三个 Pass 在 LUT 组织、介质模型和散射公式上与 Sébastien Hillaire 的论文 [*A Scalable and Production Ready Sky and Atmosphere Rendering Technique*](https://doi.org/10.1111/cgf.14050) 高度一致。可以确认的是，HGRP 同样组织了 Transmittance、Multiple Scattering 和 Sky View 三类 LUT，同时在参数化与采样策略上采用了不同的取舍。

## 理论起点：光在大气中如何变化

这一节使用的参与介质、消光、透射率、内散射与相位函数等基础概念，可以配合阅读 [《Real-Time Rendering 4th》中文版 Chapter 14：体积与半透明渲染（14.1 光线散射理论）](https://github.com/Morakito/Real-Time-Rendering-4th-CN/blob/master/sourceFile/Chapter%2014%20Volumetric%20and%20Translucency%20Rendering%20%E4%BD%93.md#141-%E5%85%89%E7%BA%BF%E6%95%A3%E5%B0%84%E7%90%86%E8%AE%BA)。该章还在 14.4 节集中讨论了天空、大气透视与云，有助于理解后续三张 LUT 的物理背景。

在沿一条观察射线前进时，一般认为光能会发生两类变化：原有方向上的光因为吸收和外散射而减少，其他方向的光则可能通过发射或内散射加入当前方向。

使用符号：

- $x(s)$：射线上由路径参数 $s$ 确定的位置。
- $\omega$：当前追踪的光线方向。
- $L(x,\omega)$：位置 $x$ 处沿方向 $\omega$ 传播的 Radiance。后文 Shader 中的 `Luminance` 沿用实现命名，但物理推导统一使用 $L$。
- $\sigma_a$、$\sigma_s$：吸收系数和散射系数。
- $\sigma_t=\sigma_a+\sigma_s$：消光系数（Extinction Coefficient）。
- $p(\omega_i,\omega)$：相位函数，描述从入射方向 $\omega_i$ 散射到方向 $\omega$ 的比例。

RTR4 使用下图概括了参与介质中会影响 Radiance 的四种事件：

![参与介质中影响 Radiance 的四类事件](/images/hgrp-atmosphere-part1/01-radiance-events.png)

*图 1：参与介质中影响 Radiance 的四类事件。参考 RTR4 Chapter 14。*

- **吸收（Absorption）**：光能被介质吸收并转化为其他形式的能量。
- **外散射（Out-scattering）**：光子被散射到当前追踪方向之外。
- **发射（Emission）**：介质自身向当前方向注入光能，例如高温火焰的热辐射。
- **内散射（In-scattering）**：来自其他方向的光被散射进当前方向。

对应的辐射传输方程（Radiative Transfer Equation，RTE）可以写成：

$$
\frac{dL(x,\omega)}{ds}
=\underbrace{-\sigma_t(x)L(x,\omega)}_{\text{吸收与外散射}}
+\underbrace{\sigma_a(x)L_e(x,\omega)}_{\text{发射}}
+\underbrace{\sigma_s(x)\int_{S^2}p(\omega_i,\omega)L(x,\omega_i)d\omega_i}_{\text{内散射}}
$$

第一项描述光在传播过程中的损失；第二项描述介质自身发光；第三项则对整个球面上的入射方向积分，统计有多少光被散射进当前方向。相位函数 $p$ 在体渲染中的作用与表面渲染中的 BRDF 类似，决定散射能量的方向分布。

### 大气模型中的简化

对于本文讨论的冷大气，可以忽略介质自发光。太阳距离足够远，也可以近似为平行光。若暂时只考虑太阳直射产生的单次散射，并把太阳表示为方向光照度 $E_{sun}$，内散射源项可以写成：

$$
j_{sun}(x,\omega)
=T_{sun}(x)\,\sigma_s(x)\,p(\omega_{sun},\omega)\,E_{sun}
$$

于是单次散射下的 RTE 可以简化为：

$$
\frac{dL(x,\omega)}{ds}=-\sigma_t(x)L(x,\omega)+j_{sun}(x,\omega)
$$

这里的 $T_{sun}(x)$ 表示太阳光从大气层边界传播到 $x$ 时的透射损失，而这正是 Pass 1 的 T-LUT 要解决的问题。

需要强调：这里暂时忽略地表反射，只是为了解释太阳直射源项。HGRP 在后续 MS-LUT 中重新加入了 `GroundAlbedo` 和地表反弹，因此整套实现并没有完全舍弃地表贡献。


## 大气介质模型

Hillaire 模型通过三类高度分布拟合地球大气；HGRP 的参数缓冲也保留了对应的散射与吸收项：

- **瑞利散射（Rayleigh Scattering）**：表示空气分子。散射强度近似与波长的四次方成反比 $\lambda^{-4}$，因此短波蓝光更容易被散射。其密度随高度指数衰减。
- **米氏散射与吸收（Mie Scattering / Absorption）**：表示气溶胶、雾霾和尘埃等较大粒子。它对波长的选择性弱于瑞利散射，并常表现出明显的前向散射；密度同样随高度指数衰减，但主要集中在近地面区域。
- **臭氧吸收（Ozone Absorption）**：主要表现为选择性吸收，不参与散射。实现中使用近似的帐篷形分布，将浓度集中在平流层高度范围内。





下面按照这三张 LUT 的依赖顺序逐个分析。
## Pass 1：Transmittance LUT

这个 Pass 的目的是生成透射率查找表（Transmittance LUT / T-LUT）。它回答的问题是：“从任意高度 $r$ 出发，沿任意天顶角 $\mu$ 穿过大气后，RGB 三个波段的光还剩多少能量？”在后续 Pass 中，它主要用于查询太阳光到达大气中某一点时的透射率，即 $j_{sun}(x)$ 中的 $T_{sun}(x)$。

从 Vulkan 截帧可以看到，这一阶段只有一个 Draw Call，颜色附件就是 T-LUT：

![Pass 1 的 RenderPass 与 Draw Call](/images/hgrp-atmosphere-part1/02-pass1-renderpass.png)

*图 2：Pass 1 的 RenderPass 与 Draw Call。*

![Transmittance LUT 输出](/images/hgrp-atmosphere-part1/03-transmittance-lut.png)

*图 3：Pass 1 输出的 Transmittance LUT。*

### 从反编译代码还原执行流程

T-LUT 的输入、介质组成和输出：

```glsl
layout(set = 3, binding = 0, std140) uniform AtmosphereParams
{
    vec4 RadiusParams;
    vec4 RayleighParams;
    vec4 MieScattering;
    vec4 MieAbsorption;
    vec4 OzoneExtinction;
    vec4 OzoneTentParams1;
    vec4 SunDirectionAndTSamples;
} Atmo;

layout(location = 0) in vec2 uv;
layout(location = 0) out vec3 OutTransmittance;
```

这里没有输入太阳方向或太阳颜色，只有行星半径、介质参数和步进次数；输出名称则明确是 `OutTransmittance`。因此，这个 Pass 计算的是大气本身对一条路径的透射率。

第一步是把 LUT 的二维坐标恢复为物理状态。`uv.y` 先被映射为切线距离，再恢复采样点半径 $r$；`uv.x` 则在允许的路径长度范围内插值，最后反推出天顶角余弦 $\mu$：

```glsl
float v_distance = Atmo.RadiusParams.z * uv.y;
float r = sqrt(v_distance * v_distance
             + Atmo.RadiusParams.y * Atmo.RadiusParams.y);

float distToTop = Atmo.RadiusParams.x - r;
float mapped_x = distToTop
               + uv.x * ((v_distance + Atmo.RadiusParams.z) - distToTop);

float mu = clamp(
    ((Atmo.RadiusParams.z * Atmo.RadiusParams.z - v_distance * v_distance)
     - mapped_x * mapped_x) / (2.0 * r * mapped_x),
    -1.0, 1.0);
```

得到 $(r,\mu)$ 后，Shader 求光线到大气层顶的距离，并用固定步数执行 Ray Marching：

```glsl
float rayLength = max(0.0,
    -r * mu + sqrt(max(0.0,
    r * r * (mu * mu - 1.0) + R_top * R_top)));

float stepSize = rayLength / max(Atmo.SunDirectionAndTSamples.w, 1.0);
```

循环内部按照当前高度重新计算瑞利、米氏与臭氧密度，并通过 Ray Marching 将各通道的消光系数积分为光学厚度：

```glsl
float currentHeight = max(0.0,
    sqrt(t * (t + 2.0 * r * mu) + r * r) - R_bottom);

float mieDensity = exp(currentHeight * Atmo.MieAbsorption.w);

opticalDepth += (
    Atmo.RayleighParams.xyz * exp(currentHeight * Atmo.RayleighParams.w)
  + Atmo.MieScattering.xyz * mieDensity
  + Atmo.MieAbsorption.xyz * mieDensity
  + Atmo.OzoneExtinction.xyz * ozoneDensity
) * stepSize;
```

最后一行就是整个 Pass 的落点：使用 Beer–Lambert 定律把光学厚度转换为透射率。

```glsl
OutTransmittance = exp(-opticalDepth);
```

这也解释了输出图中三个通道为什么不同：瑞利、米氏和臭氧的系数都是 RGB 向量，不同波段在同一路径上会留下不同的能量比例。


### LUT 的输入与输出

- `uv.y` 最终恢复采样点距地心的半径 $r$，也就是观察点的高度状态。
- `uv.x` 最终恢复光线天顶角余弦 $\mu=\cos\theta$，也就是光线相对局部天顶的方向。
- 输出 `vec3(R,G,B)` 位于 $[0,1]$ 区间，表示三个颜色通道的透射率。

T-LUT 只描述大气介质对光线的衰减，不关心大气层外具体是什么光源：无论外面是一个太阳、双子星还是戴森球，这张表记录的都只是透射率。后续 Pass 再将光源颜色和强度乘上透射率，得到光线到达采样点后的剩余能量。

二维 LUT 使用两个坐标，因此实际实现中把空间位置约化为半径，把方向约化为相对局部天顶的夹角。

### `uv.y`：非线性的半径参数化

```
// x: 大气层顶部半径 (R_top)
// y: 行星地表半径 (R_bottom)
// z: 最大地平线距离 sqrt(R_top^2 - R_bottom^2)
// w: Padding
vec4 RadiusParams;
```

```glsl
// 1. 计算切线方向上的距离
float v_distance = Atmo.RadiusParams.z * uv.y;

// 2. 距离的平方
float v_distance_sq = v_distance * v_distance;

// 3. 勾股定理求当前点距地心的半径 r
float r = sqrt(v_distance_sq + (Atmo.RadiusParams.y * Atmo.RadiusParams.y));
```


![T-LUT 半径参数化的几何关系](/images/hgrp-atmosphere-part1/04-transmittance-geometry.png)

*图 4：采样点半径、地心与大气层顶切线距离之间的关系。*

代码中的 `Atmo.RadiusParams.z` 是最大地平线距离：

$$D_{max} = \sqrt{R_{top}^2 - R_{bottom}^2}$$

它对应从大气层顶向地表球作切线时，切点到大气层顶的距离。

`v_distance = Atmo.RadiusParams.z * uv.y` 将 `[0,1]` 映射到 `[0,D_{max}]`，再通过勾股关系恢复采样点距地心的半径：

$r = \sqrt{v_distance^2 + R_{bottom}^2}$

由于 $r$ 对 `uv.y` 的导数在地表附近较小，这种参数化会为近地表的半径变化分配更多精度。在球形大气、介质参数只随高度变化的假设下，经纬度位置可以被约去；但透射率仍同时取决于半径 $r$ 和方向 $\mu$。


### `uv.x`：通过路径长度映射方向

确定 $r$ 后，还需要确定光线方向。同样，`uv.x` 也不直接线性存储角度 $\theta$，而是先映射光线到大气层顶的物理路径长度 $d$，即下图中点 P 到点 X 的距离，再反推出 $\mu=\cos\theta$。

![T-LUT 路径长度参数化的几何关系](/images/hgrp-atmosphere-part1/05-transmittance-parameterization.png)

*图 5：固定采样点后，使用到大气层顶的路径长度恢复观察方向。*


在三角形 $XOP$ 中，由余弦定理可得：

$$
\cos(\pi-\theta)=\frac{r^2+d^2-R_{top}^2}{2rd}
$$

其中，$r$ 代表 $X$ 到地心的距离，$d$ 代表 $X$ 到大气层顶交点 $P$ 的路径长度，$R_{top}$ 代表大气层顶部半径。

固定采样点 $X$ 后，让大气层顶交点 $P$ 沿球面移动，路径长度 $d$ 与天顶角余弦 $\cos\theta$ 会随之改变。LUT 线性存储 $d$，查询时再由球面几何恢复方向。

两条坐标轴承担不同任务：`uv.y` 提高近地表的半径分辨率，`uv.x` 以路径长度而不是角度映射方向，从而更好地表达长光程和切线附近快速变化的透射率。

## Pass 2：Multiple-Scattering LUT

Pass 2 的目的是预计算高阶多重散射的近似结果。它读取 T-LUT，并为每一组“采样点半径 $r$、太阳天顶角余弦 $\mu_s$”记录一个与相机观察方向无关的环境散射量，供 Sky-View LUT 在视线积分时直接查询。

![Multiple-Scattering LUT 输出](/images/hgrp-atmosphere-part1/06-multiple-scattering-lut.png)

*图 6：Pass 2 的 MS-LUT 输出。*

![提高曝光后的 Multiple-Scattering LUT](/images/hgrp-atmosphere-part1/07-multiple-scattering-lut-exposed.png)

*图 7：提高显示曝光后的 MS-LUT，仅用于观察低能量结构，不代表 LUT 内烘入了曝光。*

### LUT 的坐标与存储内容

X 轴线性编码太阳天顶角余弦：

$$
\mu_s=\cos\theta_s=2uv.x-1
$$

- `uv.x = 0`：$\mu_s=-1$，太阳位于局部天底方向。
- `uv.x = 0.5`：$\mu_s=0$，太阳位于局部地平线方向。
- `uv.x = 1`：$\mu_s=1$，太阳位于局部天顶方向。

Y 轴线性编码采样点距地心的半径：

$$
r=R_{bottom}+uv.y(R_{top}-R_{bottom})
$$

因此 `uv.y = 0` 对应地表，`uv.y = 1` 对应大气层顶。纹理 RGB 存储的是单位太阳 RGB 强度下、由二次及更高阶散射和地表反弹形成的传递函数近似 $\Psi_{ms}$。

### 从 RTE 推导：为什么两部分散射都不可缺少

要理解 MS-LUT 的作用，需要先回到忽略介质自发光后的 RTE 的积分形式。相机沿方向 $\omega$ 看到的 Radiance 为：

$$
L(x,\omega)
=T_{view}(x,x_d)L_{bg}
+\int_0^dT_{view}(x,x_t)S(x_t,\omega)\,dt
$$

其中 $T_{view}$ 决定采样点产生的光有多少能够存活到相机，真正决定“沿途向视线加入什么光”的是内散射源项：

$$
S(x_t,\omega)
=\sum_{k\in\{R,M\}}
\sigma_k(x_t)
\int_{S^2}p_k(\omega_i,\omega)
L_{in}(x_t,\omega_i)\,d\omega_i
$$

关键是把入射光场 $L_{in}$ 按照此前是否已经发生过散射拆成两部分：

$$
L_{in}
=\underbrace{L_{sun}}_{\text{尚未散射的太阳直射光}}
+\underbrace{L_{indirect}}_{\text{已经散射或经地表反弹的光}}
$$

太阳近似为方向光，因此第一部分只来自太阳方向：

$$
L_{sun}(x_t,\omega_i)
=T_{sun}(x_t)E_{sun}
\,\delta(\omega_i-\omega_{sun})
$$

把它代回源项的球面积分，Dirac $\delta$ 会将积分收缩到太阳方向，得到太阳直射产生的单次散射：

$$
S_{single}(x_t,\omega)
=T_{sun}(x_t)
\left[
\sigma_R(x_t)p_R(\omega_{sun},\omega)
+\sigma_M(x_t)p_M(\omega_{sun},\omega)
\right]E_{sun}
$$

这部分保留了瑞利和米氏相位函数的方向性：蓝天的角度分布、太阳附近的米氏前向光晕，都主要来自这一项。$T_{sun}$ 由 Pass 1 的 T-LUT 提供。

第二部分 $L_{indirect}$ 在到达 $x_t$ 前已经至少散射过一次；它在 $x_t$ 再散射进观察方向时，就形成二次及更高阶散射。精确计算需要递归求解整个球面上的间接入射光。HGRP 将高阶散射近似为各向同性，并把相位函数加权后的方向积分预计算为：

$$
\Psi_{ms}(x_t)
=\frac{1}{E_{sun}}
\int_{S^2}p_{iso}(\omega_i)
L_{indirect}(x_t,\omega_i)\,d\omega_i,
\qquad p_{iso}=\frac{1}{4\pi}
$$

于是高阶散射源项可以直接写成：

$$
S_{ms}(x_t)
=\sigma_s(x_t)\Psi_{ms}(x_t)E_{sun},
\qquad \sigma_s=\sigma_R+\sigma_M
$$

$\Psi_{ms}$ 已经对入射方向完成积分，因此不再依赖观察方向 $\omega$。在球形、静态大气的假设下，它只需要由采样点半径 $r$ 和太阳天顶角余弦 $\mu_s$ 索引，这正是每个 MS-LUT texel 存储的 RGB 结果。

将两部分重新放回 RTE，Sky-View Pass 实际积分的是：

$$
\begin{aligned}
L(x,\omega)
=\;&T_{view}(x,x_d)L_{bg}\\
&+\int_0^dT_{view}(x,x_t)
\Bigl\{
T_{sun}(x_t)
\left[\sigma_Rp_R+\sigma_Mp_M\right]
+\sigma_s(x_t)\Psi_{ms}(x_t)
\Bigr\}E_{sun}\,dt
\end{aligned}
$$

因此两部分不能互相替代：只保留单次散射会丢掉间接光，使天空、地平线和大气阴影区域偏暗；只保留方向无关的 MS-LUT，则会丢掉瑞利与米氏相位函数形成的主要方向结构。两项也不会重复计数：第一项只包含此前没有散射过的太阳光，第二项只包含二次及更高阶路径。

严格来说，Pass 1 并不是“单次散射 Pass”：它只计算 $T_{sun}$。Pass 3 在每个视线采样点用 T-LUT 现场计算 $S_{single}$，同时查询 Pass 2 的 MS-LUT 获得 $S_{ms}$，最后将二者一起沿视线积分。

从散射阶次看，也可以把这个关系写成 Neumann 级数。令 $\mathcal K$ 表示一次“传播并再次散射”的算子，则：

$$
L_{single}=\mathcal K L_{sun},
\qquad
L_{ms}=\left(\mathcal K^2+\mathcal K^3+\cdots\right)L_{sun}
$$

HGRP 的 Pass 2 用 Up/Down 两条内部积分路径近似 $\mathcal K^2L_{sun}$ 以及每增加一阶散射后的保留比例 $f_{ms}$，再以五项截断近似后面的级数：

$$
\Psi_{ms}(x)
\approx L_2(x)
\left(1+f_{ms}+f_{ms}^2+f_{ms}^3+f_{ms}^4\right)
$$

地表反弹也作为间接光的边界项包含在 $L_2$ 的估计中。最终每个 texel 写入：

$$
\operatorname{MSLUT}(r,\mu_s)
=m_{ms}\,\Psi_{ms}(x)
$$

![采样点周围的多重散射球面积分](/images/hgrp-atmosphere-part1/08-multiple-scattering-diagram.png)

*图 8：精确多重散射需要积分采样点周围的全部入射方向；HGRP 当前实现将其压缩为 Up/Down 两条路径。*

### 与 Shader 代码对应

Pass 2 对 T-LUT 的依赖首先体现在资源绑定上：

```glsl
layout(set = 3, binding = 0) uniform sampler texSampler;
layout(set = 3, binding = 1) uniform texture2D TransmittanceLUT;

layout(location = 0) in vec2 uv;
layout(location = 0) out vec3 OutMultiScattering;
```

随后，二维坐标被直接解释为“太阳天顶角余弦 + 采样点半径”，这正是前面给出的 MS-LUT 坐标定义：

```glsl
float r = uv.y * (Atmo.RadiusParams.x - Atmo.RadiusParams.y)
        + Atmo.RadiusParams.y;
float cosThetaSun = uv.x * 2.0 - 1.0;
```

在每个 Ray Marching 采样点，Shader 都会重新计算局部高度和太阳角度，然后查询 T-LUT。下面几行把 Pass 1 的结果真正接入了多重散射计算：

```glsl
float currentHeight = sqrt(t * (t + 2.0 * r) + r * r);
float nu_s = clamp(cosThetaSun * (r + t) / currentHeight, -1.0, 1.0);

vec3 transmittanceToSun = textureLod(
    sampler2D(TransmittanceLUT, texSampler), lutUV, 0.0).xyz;

transmittanceToSun *= earthShadow;
vec3 S_in = transmittanceToSun * scattering * ISOTROPIC_PHASE;
```

具体过程：先用 T-LUT 计算太阳光到达当前采样点后还剩多少，再剔除被行星遮挡的方向，最后乘以局部散射系数和各向同性相位函数，形成当前步长的内散射源项。

HGRP 反编译结果随后分别积累向上和向下两个方向。向下的径向射线会到达地表，并显式加入 Lambert 反射：

```glsl
GroundBounceEnergy = L_2nd_Down
    + throughput_Down
    * max(hit_nu_s, 0.0)
    * sunTransmittanceAtGround
    * Atmo.GroundAlbedo.xyz
    * INV_PI;
```



两个方向的传输比例最终被平均为 $f_{ms}$，再使用五项等比级数近似更高阶散射：

```glsl
vec3 f_ms = (f_ms_Up + f_ms_Down) * 0.5;
vec3 f_ms_sq = f_ms * f_ms;

vec3 MultiScatteringSum = vec3(1.0)
    + f_ms
    + f_ms_sq
    + f_ms_sq * f_ms
    + f_ms_sq * f_ms_sq;

OutMultiScattering = ((L_2nd_Up + GroundBounceEnergy) * 0.5)
                   * Atmo.SunParams.w
                   * MultiScatteringSum;
```



### 近似带来的性能与误差

上面的推导包含三层近似：把高阶散射视为各向同性、用有限方向替代球面积分，以及用等比级数恢复更多散射阶次。各向同性假设来自 Hillaire 方法；当前 HGRP 截帧与参考实现的主要差异在后两项。

#### 方向采样：从 64 个方向压缩到 2 个方向

即便相位函数变成了常数，要在实时渲染中对整个 $4\pi$ 球面连续积分仍然不现实，因此需要用有限数量的方向样本离散近似球面积分。

需要注意的是，**用上下两根射线代表整个球面并不是 Hillaire 论文参考实现本身的做法**。作者公开的 `NewMultiScattCS` 使用 $8\times8=64$ 个均匀分布在球面上的方向，每个方向分别进行 Ray Marching，最后在线程组内归约求和。相关实现可见：[RenderSkyRayMarching.hlsl](https://github.com/sebh/UnrealEngineSkyAtmosphere/blob/master/Resources/RenderSkyRayMarching.hlsl#L370-L480)。

而从整理出的 HGRP 反编译代码来看，它分别只沿天顶方向和地心方向积分，再将结果平均：

`vec3 f_ms = (f_ms_Up + f_ms_Down) * 0.5;`

因此，这里**HGRP 当前实现是相对于论文参考实现所做的进一步简化**：

1. 一根笔直朝向天顶（`Up`），用于收集高层稀薄大气的散射能量。

2. 一根笔直朝向地心（`Down`），用于收集低层浓密大气的散射能量（以及地表的反光）。


在路径步数相同的情况下，方向采样工作量从 $64N$ 降为 $2N$，即约为原来的 $1/32$。这不等于 GPU 时间必然缩短 32 倍——Hillaire 的 64 个方向由线程组并行执行——但总 ALU、采样和归约工作都显著减少。代价是在日出日落、地平线、高 Mie 密度或高地表反照率条件下，更容易丢失方向分布中的能量差异。

> 这里比较的只是大气 MS-LUT 的方向积分成本与误差，不能据此推断 HGRP 的整套天气、云、体积雾或体积光系统同样采用了双方向近似。它们由其他资源和 Pass 承担，详见后文。

此外，Hillaire 论文建议对 $f_{ms}$ 的每段传输使用解析积分，以帮助它保持在 $[0,1]$；当前 HGRP 代码则直接累加：

```glsl
f_ms += throughput * scattering * stepSize;
```

这是计算更简单的矩形积分，会比亮度路径中使用的解析积分更依赖步数。

#### 高阶散射：从无限级数改为五项截断

Hillaire 的参考实现默认使用无穷等比级数近似所有后续散射阶次：

$$
E\left(1+f_{ms}+f_{ms}^2+f_{ms}^3+\cdots\right)=\frac{E}{1-f_{ms}},\qquad |f_{ms}|<1
$$

当前 HGRP Shader 则采用前文推导出的五项截断形式。它是**有限项等比级数**，不是泰勒级数展开。这样可以避免 $1-f_{ms}$ 接近零时的数值问题，但会忽略五项之后的高阶散射能量：

| $f_{ms}$ | 五项截断 | 无限级数 $1/(1-f_{ms})$ | 少计算的能量 |
| ---: | ---: | ---: | ---: |
| 0.3 | 1.4251 | 1.4286 | 约 0.25% |
| 0.5 | 1.9375 | 2.0000 | 约 3.1% |
| 0.8 | 3.3616 | 5.0000 | 约 32.8% |

因此它主要是数值稳定性和容错的取舍，而不能保证物理上的能量收敛。


## Pass 3：Sky-View LUT

前两张 LUT 都与具体观察方向无关。Pass 3 才把相机、太阳和观察方向组合起来，生成当前视点可直接查询的天空颜色。

![Sky-View LUT 输出](/images/hgrp-atmosphere-part1/09-sky-view-lut.png)

*图 9：Pass 3 输出的 Sky-View LUT。*

### LUT 的坐标与存储内容

HGRP 在这里使用**半八面体方向映射（hemi-octahedral mapping）**：先把二维 UV 转换为上半球的三维 `viewDir`，再沿该方向从相机位置开始 Ray Marching。这是当前 HGRP Shader 中观察到的参数化方式；Hillaire 论文使用的是强化地平线分辨率的非线性经纬度映射，两者不能混为一谈。

每个像素包含以下状态：

- **UV**：从当前相机出发的一个上半球观察方向。
- **输入**：相机高度、太阳方向、T-LUT、MS-LUT 和大气参数。
- **输出**：该方向上的天空 RGB 亮度。有效 UV 不会生成指向地表的射线。

沿视线的每个采样点都包含两部分内散射：

$$
S_{in}
=\underbrace{T_{sun}\left(\sigma_Rp_R+\sigma_Mp_M\right)}_{\text{太阳直射产生的单次散射}}
+\underbrace{\sigma_s\Psi_{ms}}_{\text{MS-LUT 提供的高阶散射近似}}
$$

第一部分查询 T-LUT，计算太阳光到达采样点后的能量，并分别乘以瑞利与米氏相位函数；第二部分查询 MS-LUT，为当前介质补充高阶散射。二者沿视线积分后，才得到最终天空颜色。

### 从伪代码还原流程

Sky-View Pass 同时绑定了前两张 LUT：

```glsl
layout(set = 3, binding = 1) uniform texture2D TransmittanceLUT;
layout(set = 3, binding = 2) uniform texture2D MultiScatteringLUT;

layout(location = 0) in vec2 uv;
layout(location = 0) out vec3 OutSkyLuminance;
```

它消费前两个 Pass 的结果。二维 UV 首先通过半八面体映射恢复观察方向：

```glsl
float u = uv.x + uv.y - 1.0;
float v = uv.x - uv.y;
vec3 viewDir = normalize(vec3(
    u,
    1.0 - dot(abs(vec2(u, v)), vec2(1.0)),
    v));

float viewHeightCos = viewDir.y;
float cosTheta = dot(viewDir, Atmo.SunDirection.xyz);
```

令 $x=u+v-1$、$z=u-v$。对于 `uv` 的两个分量都位于 $[0,1]$ 的有效纹理坐标，有：

$$
|x|+|z|\le1
$$

因此解码方向的未归一化 Y 分量始终满足：

$$
y=1-|x|-|z|\ge0
$$

也就是说，这张纹理只覆盖局部上半球，这是个半映射。

反编译代码中虽然仍保留地表求交与地表着色分支，但 `viewHeightCos < 0` 对有效 UV 不成立；这些分支在此处确实是不可达代码。

这里的 `viewHeightCos` 决定视线相对天顶的方向，`cosTheta` 则是视线与太阳方向之间的夹角。后者会直接进入瑞利和米氏相位函数：

```glsl
float phaseRayleigh = 0.0596831 * (1.0 + cosTheta * cosTheta);

float g = Atmo.MieScattering.w;
float denominator = 1.0 + g * g - 2.0 * g * cosTheta;
float phaseMie = (1.0 - g * g)
               / max(12.56637 * denominator * sqrt(denominator), 0.001);
```

这里的米氏项是 Henyey–Greenstein相位函数。Hillaire 论文和公开参考实现默认使用 Cornette–Shanks，但论文也明确指出更简单的 HG 是可接受的替代方案。HGRP 的选择减少了一部分角度修正运算，代价是太阳附近米氏光晕的形状会有轻微差异。

HGRP的Shader 仍计算了地表求交判别式，保留了地表或大气层顶两种终点：

```glsl
float discriminant_ground = r * r * (viewHeightCos * viewHeightCos - 1.0)
                          + R_bottom * R_bottom;

bool hitGround = viewHeightCos < 0.0 && discriminant_ground >= 0.0;
float rayLength = hitGround ? distToGround : distToTopAtmosphere;
```

但由于半八面体映射保证 `viewHeightCos >= 0`，当前 Pass 实际总是选择 `distToTopAtmosphere`，也就是说不会执行这个地表的分支。

长距离的地平线方向需要更多采样，因此步数会随 `rayLength` 在最小值和最大值之间变化，并被限制在 256 步以内：

```glsl
float sampleCount = floor(mix(
    max(Atmo.RaymarchParams.y, 1.0),
    min(Atmo.RaymarchParams.z, 256.0),
    clamp(rayLength / max(Atmo.RaymarchParams.w, 1.0), 0.0, 1.0)));
```

循环中的关键部分是 `S_in`。代码先查询 T-LUT 获得太阳直射透射率，再查询 MS-LUT 获得高阶散射，最后按当前高度的介质系数组装：

```glsl
vec3 sunTransmittance = textureLod(
    sampler2D(TransmittanceLUT, texSampler), lutUV, 0.0).xyz;

vec3 msAmbient = textureLod(
    sampler2D(MultiScatteringLUT, texSampler), msLUT_UV, 0.0).xyz;

vec3 S_in = sunTransmittance
          * (rayleighScatCoef * phaseRayleigh
           + mieScatCoef * phaseMie)
          + totalScatCoef * msAmbient;
```

第一项是具有方向性的太阳单次散射，第二项是由 MS-LUT 提供的各向同性高阶散射。

每个步长的贡献是结合该段透射率进行解析积分，再乘以前面路径积累的 `throughput`：

```glsl
vec3 stepTransmittance = exp(-extinction * stepSize);

skyLuminance += throughput
              * ((S_in - S_in * stepTransmittance) / extinction);
throughput *= stepTransmittance;
```

内部分支还包含一个不可达的地表 Lambert 反射分支。对本 Pass 的有效 UV，`groundLuminance` 保持为零，因此实际输出是天空积分乘以太阳 RGB 和一个全局倍率：

```glsl
OutSkyLuminance = (skyLuminance + groundLuminance)
                * Atmo.SunParams.xyz
                * Atmo.GroundAlbedo.w;
```

这张 Sky-View LUT 是当前相机位置周围的上半球天空缓存：每个像素都对应一次具有明确起点、上半球方向、到大气层顶的积分终点、单次散射源项和多重散射源项的简化体积积分。


### runtime用途

Sky-View LUT 可以理解为一张以当前相机为中心的低分辨率上半球方向缓存。真正渲染天空背景时，不必再为每个屏幕像素完整执行大气 Ray Marching，只需将屏幕视线编码为相同的半八面体坐标并采样。太阳方向或相机高度变化时需要更新 Sky-View LUT；只改变相机朝向是否需要更新，还取决于下游查表使用的是行星局部坐标还是相机局部坐标，当前三个 Pass 本身不足以完全确认这一点。

## 与 Hillaire 论文及参考实现的差异

三张 LUT 的整体数据流来自同一类实时大气框架，但当前 HGRP 截帧并不是 Hillaire 参考实现的逐行移植。

- **T-LUT 参数化**：两者都使用 Bruneton 风格的路径长度参数化，当前截帧中没有观察到显著算法差异。
- **MS 方向积分与执行方式**：Hillaire 参考实现使用 64 个均匀球面方向，由 64-thread Compute Shader 在线程组内归约；HGRP 当前 Pass 只积分 Up/Down 两个径向方向，并以独立 Color Pass 生成 LUT。总工作量显著下降，但方向分布精度也更低。
- **$f_{ms}$ 路径积分**：Hillaire 推荐分段解析积分；HGRP 使用 `throughput * scattering * dt` 的矩形积分，运算更少，但更依赖路径步数。
- **高阶散射级数**：Hillaire 默认使用 $1/(1-f_{ms})$ 近似无限阶散射；HGRP 使用五项有限级数，在极端参数下更稳定，但高散射条件下容易偏暗。
- **Sky 参数化与采样**：Hillaire 使用强化地平线分辨率的非线性经纬度映射和路径内二次采样分布；HGRP 当前 Pass 使用半八面体上半球映射和均匀步长，控制流更简单，但不再专门提高地平线精度。
- **Mie 相位与观察范围**：Hillaire 默认使用 Cornette–Shanks，也允许 HG；HGRP 使用 Henyey–Greenstein。当前 Pass 还假设相机位于大气层内，但不能据此排除 HGRP 在其他条件下使用不同分支。

Hillaire 的 `NewMultiScattCS` 为每个 MS-LUT texel 启动 64 个方向线程，每个线程独立 Ray March，再在线程组内归约。HGRP 将其压缩为上下两条径向路径，是本文观察到的最大性能取舍。[参考实现：`NewMultiScattCS`](https://github.com/sebh/UnrealEngineSkyAtmosphere/blob/master/Resources/RenderSkyRayMarching.hlsl#L370-L482)

Sky-View 的差异同样重要。Hillaire 将天空与虚拟地面分置于纹理两部分，并用平方/平方根变换增加地平线附近的精度；HGRP 当前 Pass 把整张纹理用于上半球天空。两者目标都是用低分辨率缓存低频天空，但纹理精度的分配策略不同。[参考实现：Sky-View 参数化](https://github.com/sebh/UnrealEngineSkyAtmosphere/blob/master/Resources/RenderSkyCommon.hlsl#L105-L169)



## 三张 LUT 的关系

- **Transmittance LUT**：以半径 $r$ 和光线天顶角 $\mu$ 为坐标，根据大气介质参数存储 RGB 透射率；大气参数变化时需要更新。
- **Multiple-Scattering LUT**：以半径 $r$ 和太阳天顶角 $\mu_s$ 为坐标，读取 T-LUT 与地表反照率，存储单位太阳 RGB 下的各向同性高阶散射传递函数；大气参数或地表反照率变化时需要更新。
- **Sky-View LUT**：以上半球观察方向为坐标，读取 T-LUT、MS-LUT、相机与太阳状态，存储当前视点的天空 RGB 亮度；相机高度、太阳状态或大气参数变化时需要更新。

整个过程可以归纳为：T-LUT 解决“太阳光能否到达采样点”，MS-LUT 解决“高阶散射为采样点补充多少环境光”，Sky-View LUT 则沿相机视线把二者积分成最终可见的天空。
需要注意的是，Sky-View LUT 并不等同于最终屏幕上看到的天空。它描述的是大气本身的辐射结果，后续天空渲染仍会在此基础上合成天体、天气层以及其他体积介质。

## 与 HGRP 整体天气和体积系统的关系

继续追踪当前截帧中的下游消费者与相关 Pass，可以发现 T-LUT、MS-LUT 与 Sky-View LUT 只构成了 HGRP 天气渲染系统中的大气背景部分；最终天气画面还会继续与云层、远景天体、局部体积介质以及场景光照系统发生交互。

- **天空、云层与远景天体合成**：Sky-View LUT 主要负责描述玩家所在地行星尺度的大气背景辐射，并不直接代表最终天空。在当前截帧的后续 Composition 阶段，云层来自贴图（Map）采样与合成，而不是本文三个 Pass 中的体积云 Ray Marching；引擎还会继续叠加独立天空层和远距离球形天体。实际游玩中，在四号谷地能够直接观察到巨大的 Talos-1 天体表面及其大气边缘。

- **体积光散射与视线积分**：在天空之外，管线中还存在一套基于 Froxel 的三维体积介质管线，Froxel 系统内部还存在独立的 Light Scattering 计算与积分过程。其 Pass 为每个 Froxel 计算局部的 scattering source 与 extinction，随后通过沿相机视线从近到远的积分，将这些局部结果转换为累计的 In-scattering 与 Transmittance。最终得到的三维 Integrated Light Scattering Volume 可以被天空以及其他场景 Pass 直接采样。

- **天气对局部光照的驱动**：Local Illumination 阶段暴露了较丰富的天气参数，说明当前天气状态还会进一步参与场景和角色渲染，而不只是改变天空背景。萤石公开展示的雨天效果、武陵地区的特殊天气以及后续雪山环境，也体现了天气系统对多个渲染模块的共同驱动。


因此，从整体结构来看，HGRP 的天气系统d接近一个跨多个渲染阶段的环境框架：Sky Atmosphere LUT 负责行星尺度的大气背景，Sky Composition 负责天气层与远景天体，Froxel Volume 负责相机视锥内的参与介质，而 Local Illumination 等后续阶段则进一步将天气状态传播到场景光照中。三张大气 LUT 只是其中最基础、同时也是最容易单独识别的一部分。

由此可以得到一个更合理的架构解释：HGRP 对低频、远景的大气多重散射采用了激进的低成本近似，同时把云层、近景体积介质、体积光散射和局部天气光照拆分到更有针对性的管线中。至于阴影、GI 与天气系统如何进一步组合，将留待后续文章分析。


## 参考资料

- Tomas Akenine-Möller et al., [《Real-Time Rendering 4th》中文版 Chapter 14：体积与半透明渲染](https://github.com/Morakito/Real-Time-Rendering-4th-CN/blob/master/sourceFile/Chapter%2014%20Volumetric%20and%20Translucency%20Rendering%20%E4%BD%93.md)，Morakito 中文社区译本。
- Sébastien Hillaire, [*A Scalable and Production Ready Sky and Atmosphere Rendering Technique*](https://doi.org/10.1111/cgf.14050), EGSR 2020.
- Sébastien Hillaire, [UnrealEngineSkyAtmosphere 参考实现](https://github.com/sebh/UnrealEngineSkyAtmosphere).
- [Sky and Atmosphere rendering: A physical approach - CPP Rendering - Antoine MORRIER](https://cpp-rendering.io/sky-and-atmosphere-rendering/)
