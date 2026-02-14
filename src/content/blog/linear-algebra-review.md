---
title: "Linear Algebra Review"
date: 2026-02-14
author: "Muxi"
tags: ["Linear Algebra", "Rendering", "Math"]
excerpt: "A review of linear algebra concepts relevant to graphics rendering, including matrix transformations, coordinate spaces, and projection."
---

## 线性变换与矩阵向量乘积

线性变换 **挤压拓展空间** <br/>
网格线分布仍然是平行且等距分布的 且原点不变 <br/>
<br/>
从本质上来讲 这种变换只会对空间的基向量做改变

<img src="/images/linear-algebra-review-image.png" style="width: 100%; height: auto; display: block; margin: 20px auto;" alt="Linear transformation diagram" />

如图 （a，c） 和（b，d）代表 i j 两基向量变换后的坐标表示 （x，y）代表向量坐标 <br/>
<br/>
因为网格线分布仍然是平行且等距分布的 <br/>
<br/>
所以变换以后的该向量 仍等于 x 倍的 i 向量和 y 倍的 j 向量之和 <br/>

结果如上 <br/>
我们把这个计算得出来的过程与结果称之为矩阵向量乘积 <br/>

即：对坐标系（两基向量）改变后得到的矩阵（变换矩阵）与 原向量 的乘积 == 变换后该向量的坐标表示 <br/>
它的数学形式如图 但几何意义即上 代表一个矩阵对向量的作用（一个线性变换对向量的作用） <br/>

## 复合变换

顾名思义 即多个变换的叠加作用后形成的变换

<img src="/images/linear-algebra-review-image-1.png" style="width: 100%; height: auto; display: block; margin: 20px auto;" alt="Composite transformation 1" />

做 M1 和 M2 代表的两个变换

<img src="/images/linear-algebra-review-image-2.png" style="width: 100%; height: auto; display: block; margin: 20px auto;" alt="Composite transformation 2" />

<img src="/images/linear-algebra-review-image-3.png" style="width: 100%; height: auto; display: block; margin: 20px auto;" alt="Composite transformation 3" />

<img src="/images/linear-algebra-review-image-4.png" style="width: 100%; height: auto; display: block; margin: 20px auto;" alt="Composite transformation 4" />

上述运算代表这个过程 <br/>
对于 M1 矩阵中的基向量 (e , g) 和 (f , h) 我们对它们采用都 M2 代表的线性变换 <br/>
<br/>
最终得出的矩阵 M3 <br/>
<br/>
即代表这两个矩阵对于基向量的复合作用 数学形式如上 <br/>

**性质:** <br/>
<br/>
**M1 M2 ≠ M2 M1** <br/>
<br/>
**(M1 M2)M3 = M1(M2 M3)** <br/>

## 更图形学化的理论方面
  
对于法线变换至世界空间

<img src="/images/linear-algebra-review-Untitled.png" style="width: 100%; height: auto; display: block; margin: 20px auto;" alt="Normal transformation to world space diagram 1" />

<img src="/images/linear-algebra-review-Untitled-1.png" style="width: 100%; height: auto; display: block; margin: 20px auto;" alt="Normal transformation to world space diagram 2" />

### 关于 HLSL

首先 HLSL（High-Level Shader Language）默认使用 **列主序（Column-Major Order）** 来存储矩阵，这意味着：<br/>
<br/>
- 矩阵中的索引 `A[i]` 是矩阵的第 i **列**。<br/>

例如以下：

```cpp
(_u_xlat0.xyz = (_u_xlat0.xyz * _u_xlat1.yyy));

(_u_xlat0.xyz = ((_in_TANGENT0.xyz * _u_xlat1.xxx) + _u_xlat0.xyz));
(_u_xlat0.xyz = ((_in_NORMAL0.xyz * _u_xlat1.zzz) + _u_xlat0.xyz));

// 按照某个向量的xyz三个分量标量 对法线 副法线和切线向量进行缩放并加和
// _u_xlat0.xyz = 副法线向量 * _in_TEXCOORD3的y标量 + _in_TANGENT0 * _in_TEXCOORD3的x标量 + _in_NORMAL0* _in_TEXCOORD3的z标量

(_u_xlat1 = (_hlslcc_mtx4x4unity_ObjectToWorld[1].yyyy * _hlslcc_mtx4x4unity_MatrixV[1]));
(_u_xlat1 = ((_hlslcc_mtx4x4unity_MatrixV[0] * _hlslcc_mtx4x4unity_ObjectToWorld[1].xxxx) + _u_xlat1));
(_u_xlat1 = ((_hlslcc_mtx4x4unity_MatrixV[2] * _hlslcc_mtx4x4unity_ObjectToWorld[1].zzzz) + _u_xlat1));
(_u_xlat1 = ((_hlslcc_mtx4x4unity_MatrixV[3] * _hlslcc_mtx4x4unity_ObjectToWorld[1].wwww) + _u_xlat1));

(_u_xlat3.xz = (_u_xlat0.yy * _u_xlat1.xy));
(_u_xlat1 = (_u_xlat1 * _in_POSITION0.yyyy));

(_u_xlat2 = (_hlslcc_mtx4x4unity_ObjectToWorld[0].yyyy * _hlslcc_mtx4x4unity_MatrixV[1]));
(_u_xlat2 = ((_hlslcc_mtx4x4unity_MatrixV[0] * _hlslcc_mtx4x4unity_ObjectToWorld[0].xxxx) + _u_xlat2));
(_u_xlat2 = ((_hlslcc_mtx4x4unity_MatrixV[2] * _hlslcc_mtx4x4unity_ObjectToWorld[0].zzzz) + _u_xlat2));
(_u_xlat2 = ((_hlslcc_mtx4x4unity_MatrixV[3] * _hlslcc_mtx4x4unity_ObjectToWorld[0].wwww) + _u_xlat2));

(_u_xlat0.xy = ((_u_xlat2.xy * _u_xlat0.xx) + _u_xlat3.xz));
(_u_xlat1 = ((_u_xlat2 * _in_POSITION0.xxxx) + _u_xlat1));

(_u_xlat2 = (_hlslcc_mtx4x4unity_ObjectToWorld[2].yyyy * _hlslcc_mtx4x4unity_MatrixV[1]));
(_u_xlat2 = ((_hlslcc_mtx4x4unity_MatrixV[0] * _hlslcc_mtx4x4unity_ObjectToWorld[2].xxxx) + _u_xlat2));
(_u_xlat2 = ((_hlslcc_mtx4x4unity_MatrixV[2] * _hlslcc_mtx4x4unity_ObjectToWorld[2].zzzz) + _u_xlat2));
(_u_xlat2 = ((_hlslcc_mtx4x4unity_MatrixV[3] * _hlslcc_mtx4x4unity_ObjectToWorld[2].wwww) + _u_xlat2));

(_u_xlat0.xy = ((_u_xlat2.xy * _u_xlat0.zz) + _u_xlat0.xy));
(_u_xlat1 = ((_u_xlat2 * _in_POSITION0.zzzz) + _u_xlat1));

// _u_xlat1顶点坐标从世界空间到相机空间（非裁剪）

(_u_xlat0.z = 0.001);
(_u_xlat6 = dot(_u_xlat0.xyz, _u_xlat0.xyz));
(_u_xlat6 = rsqrt(_u_xlat6));
(_u_xlat0.xy = (vec2_ctor(_u_xlat6) * _u_xlat0.xy));

(_u_xlat2 = (_hlslcc_mtx4x4unity_ObjectToWorld[3].yyyy * _hlslcc_mtx4x4unity_MatrixV[1]));
(_u_xlat2 = ((_hlslcc_mtx4x4unity_MatrixV[0] * _hlslcc_mtx4x4unity_ObjectToWorld[3].xxxx) + _u_xlat2));
(_u_xlat2 = ((_hlslcc_mtx4x4unity_MatrixV[2] * _hlslcc_mtx4x4unity_ObjectToWorld[3].zzzz) + _u_xlat2));
(_u_xlat2 = ((_hlslcc_mtx4x4unity_MatrixV[3] * _hlslcc_mtx4x4unity_ObjectToWorld[3].wwww) + _u_xlat2));

(_u_xlat1 = ((_u_xlat2 * _in_POSITION0.wwww) + _u_xlat1));
```

视图矩阵只改变顶点的坐标表示，但顶点之间的相对位置和形状保持不变：

<img src="/images/linear-algebra-review-Pasted-image-20241211143457.png" style="width: 100%; height: auto; display: block; margin: 20px auto;" alt="View matrix transformation 1" />

<img src="/images/linear-algebra-review-Pasted-image-20241211144229.png" style="width: 100%; height: auto; display: block; margin: 20px auto;" alt="View matrix transformation 2" />

<img src="/images/linear-algebra-review-Pasted-image-20241211144826.png" style="width: 100%; height: auto; display: block; margin: 20px auto;" alt="View matrix transformation 3" />

<img src="/images/linear-algebra-review-Pasted-image-20241211150157.png" style="width: 100%; height: auto; display: block; margin: 20px auto;" alt="View matrix transformation 4" />

### **对象空间（Object Space / Model Space）**

#### 坐标含义：

- 顶点坐标相对于模型的本地坐标系。
- 通常，模型的原点 `(0, 0, 0)` 是模型的几何中心或一个定义的基准点。
- 没有经过任何变换，是模型在未移动、旋转或缩放时的原始坐标。

#### `(x, y, z, w)` 的意义：

- `(x, y, z)`：顶点的本地位置。
- `w = 1`：表示这是一个位置（非方向）。

### **世界空间（World Space）**

#### 坐标含义：

- 顶点坐标相对于场景的全局坐标系。
- 通过 **模型矩阵（Model Matrix）** 将对象空间的坐标变换为世界空间坐标。
- 世界空间定义了所有对象的统一坐标系，通常场景的原点 `(0, 0, 0)` 是世界的基准点。

#### `(x, y, z, w)` 的意义：

- `(x, y, z)`：顶点在世界坐标系中的位置。
- `w = 1`：表示这是一个位置。
- 如果是法线等方向性数据，`w = 0`（方向向量没有平移分量）。

### **视图空间（View Space / Camera Space / Eye Space）**

#### 坐标含义：

- 顶点坐标相对于摄像机的位置和方向。
- 通过 **视图矩阵（View Matrix）** 将世界空间的坐标变换到视图空间。
- 在视图空间中，摄像机位于原点 `(0, 0, 0)`，朝向 -Z 轴。

#### `(x, y, z, w)` 的意义：

- `(x, y, z)`：顶点相对于摄像机的方向和距离。
    - `z` 的值表示顶点与摄像机的距离，通常用于深度测试。
- `w = 1`：表示这是一个位置。
- 视图空间的坐标以相机（观察者）为中心，表示物体相对于相机的位置。
- z 的值表示顶点离相机的距离：
    - 如果 z<0，说明物体在相机的前方（可见）。
    - 如果 z>0，则物体在相机的后方（不可见）。

<img src="/images/linear-algebra-review-world-view-space.png" style="width: 100%; height: auto; display: block; margin: 20px auto;" alt="World and view space" />

### **裁剪空间（Clip Space）**

#### 坐标含义：

- 顶点经过 **投影矩阵（Projection Matrix）** 变换后，从视图空间转换到裁剪空间。
- 裁剪空间是一个 4D 空间，坐标范围是 `[-w, w]`，在透视投影中保留深度信息。
- 坐标的范围将在光栅化阶段被裁剪到视锥体内部。

<img src="/images/linear-algebra-review-Pasted-image-20241216151638.png" style="width: 100%; height: auto; display: block; margin: 20px auto;" alt="Clip space" />

#### `(x, y, z, w)` 的意义：

- `(x, y, z)`：经过投影变换后的坐标。
	 `x`  `y` `z`  都是顶点在经过矩阵空间变换后的坐标
- `w`：用于透视除法（将裁剪空间坐标转换为归一化设备坐标）。

### 对于正交投影 

<img src="/images/linear-algebra-review-Pasted-image-20241216155206.png" style="width: 100%; height: auto; display: block; margin: 20px auto;" alt="Orthographic projection diagram" />

正交投影矩阵

<img src="/images/linear-algebra-review-Pasted-image-20241216155230.png" style="width: 100%; height: auto; display: block; margin: 20px auto;" alt="Orthographic projection matrix" />

这是一个复合矩阵 C = AB
B 代表缩放矩阵
A 代表转移矩阵

视图空间坐标经过正交投影矩阵变换后 w 值仍然不变 = 1 
而 xyz 直接表示它在规则观察体下的坐标

也就是说可以 直接按照此时的 `(x, y, z)` 是否位于 -1 到 1 进行裁剪

### 对于透视投影 

透视投影矩阵

<img src="/images/linear-algebra-review-Pasted-image-20241216174925.png" style="width: 100%; height: auto; display: block; margin: 20px auto;" alt="Perspective projection matrix" />

这之后的坐标
视图空间坐标经过正交投影矩阵变换后 (x,y,z,w) 仍然是齐次坐标 

$$
P' = (x,y,z,w)
$$

孩子们 投影矩阵这个说法好像是不准确的 <br/>
实际上 投影矩阵处理后的坐标 P' 只是转换空间后的坐标 而不是投影操作后的坐标 <br/>
此时的 w 代表相机空间下的 z 坐标 表示其深度 <br/>
而 xyz 三个坐标表示分别被缩放后的坐标值 <br/>

- 如果一个顶点在视锥体内，那么它变换后的坐标必须满足：   
	` -w ≤ x ≤ w `
	` -w ≤ y ≤ w ` 
	` -w ≤ z ≤ w `
- 也就是除以 w 后
	` -1 ≤ x ≤ 1 `
	` -1 ≤ y ≤ 1 `
	` -1 ≤ z ≤ 1 `
	这样的点才位于规则观察体的内部

综上所示 投影矩阵有两个目的：

- 首先是为投影做准备。这是个迷惑点，虽然投影矩阵的名称包含了投影二字，但是它并没有进行真正的投影工作，而是在为投影做准备。真正的投影发生在后面的齐次除法(homogeneous division)过程中。而经过投影矩阵的变换后，顶点的 w 分量将会具有特殊的意义。
- 其次是对 x、 y、 z 分量行进缩放。我们上面讲过直接使用视锥体的6个裁剪平面来进行裁剪会比较麻烦。而经过投影矩阵的缩放后，我们可以直接使用 w 分量作为一个范围值，如果 x、 y、 z 分量都位于这个范围内，就说明该顶点位于裁剪空间内。

所以 实际上的投影操作在下面这步 NDC 中完成 真正实现把三维物体转变为二维图像

### **归一化设备坐标（Normalized Device Coordinates, NDC）**

#### 坐标含义：

- 通过 **透视除法**（将裁剪空间坐标除以 `w`）将坐标转换到一个标准化的范围。
- 归一化设备坐标范围为 `[-1, 1]`。

#### `(x, y, z, w)` 的意义：

- `(x, y)`：表示屏幕上的横纵坐标范围，`[-1, 1]` 映射到屏幕像素的整个范围。
- `z`：表示深度值，通常在 `[0, 1]`（有时为 `[-1, 1]` 取决于图形 API）。
- `w` 不再被使用。

### 为什么在顶点着色器中 position 对应的 buffer 数要比实际的几何顶点数多很多？

*(Reference to external note: `[[为什么在顶点着色器中 position对应的buffer 数要比实际的几何顶点数多很多？]]` - Content pending)*

### **片元着色器如何依赖顶点着色器**

片元着色器依赖顶点着色器的输出，但它并不直接运行在顶点上，而是运行在光栅化后生成的片元上。

#### 插值过程：

- 顶点着色器输出的每个顶点属性（如颜色、纹理坐标）会经过光栅化阶段进行插值。
- 插值使用三角形内片元的 **重心坐标（Barycentric Coordinates）**： 

`属性值 = w1 * 属性1 + w2 * 属性2 + w3 * 属性3` 

其中：
- `w1, w2, w3` 是片元在三角形内的重心坐标权重。
- `属性1, 属性2, 属性3` 是三角形顶点的属性值（来自顶点着色器）。

#### 片元着色器的输入：

- 片元着色器接收到插值后的属性值，并使用它们计算片元的颜色。

| 阶段  | 运行对象 | 运行次数 |
| --- | ---- | ---- |
| 顶点着色器 | 每个顶点 | 等于索引缓冲区的长度（顶点数）。 |
| 片元着色器 | 每个片元（像素） | 等于屏幕上被三角形覆盖的像素数（片元数）。 |

### OpenGL vs DirectX 转换与兼容性

```cpp
VS_OUTPUT generateOutput(VS_INPUT input)
{
    VS_OUTPUT output;
    output.gl_Position = gl_Position;
    output.dx_Position.x = gl_Position.x;
    output.dx_Position.y = clipControlOrigin * gl_Position.y;

    if (clipControlZeroToOne)
    {
        output.dx_Position.z = gl_Position.z;
    } else {
        output.dx_Position.z = (gl_Position.z + gl_Position.w) * 0.5;
    }

    output.dx_Position.w = gl_Position.w;
    return output;
}
```

### 一些奇怪的矩阵

## `hlslcc_mtx4x4_XShadowWorldToProj`

将顶点坐标从**世界空间**转换到**光源投影空间**，通常用于阴影映射技术中计算阴影坐标。
