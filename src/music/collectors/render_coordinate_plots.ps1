param([Parameter(Mandatory=$true)][string]$OutputDir,[switch]$LibraryOnly)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$outputPath=[IO.Path]::GetFullPath($OutputDir)
$localRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.local'))+[IO.Path]::DirectorySeparatorChar
if(-not $outputPath.StartsWith($localRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Output must remain under music/.local'}
$data=Get-Content -LiteralPath (Join-Path $outputPath 'plot_payload.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$models=@('A','B1','B2','C1','C2')
$labels=@{A='ReccoBeats V / Energy';B1='MuSe V/A - theoretical';B2='MuSe V/A - observed';C1='Recco V + MuSe A - theoretical';C2='Recco V + MuSe A - observed'}
$script:drawn=@{};foreach($key in $models){$script:drawn[$key]=0}
$anchors=@(@(68,1,84),@(59,82,139),@(33,145,140),@(94,201,98),@(253,231,37))
$palette=@()
for($index=0;$index -lt 256;$index++){
    $position=4*$index/255.0;$segment=[Math]::Min(3,[int][Math]::Floor($position));$fraction=$position-$segment
    $rgb=@();for($channel=0;$channel -lt 3;$channel++){$rgb+=([int][Math]::Round($anchors[$segment][$channel]*(1-$fraction)+$anchors[$segment+1][$channel]*$fraction))}
    $palette+=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb($rgb[0],$rgb[1],$rgb[2]))
}
function Label($g,[string]$text,[float]$x,[float]$y,[float]$size=20,[string]$align='left',[bool]$bold=$false){
    $style=[Drawing.FontStyle]::Regular;if($bold){$style=[Drawing.FontStyle]::Bold}
    $font=[Drawing.Font]::new('Segoe UI',$size,$style,[Drawing.GraphicsUnit]::Pixel)
    $brush=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(34,47,62))
    try{
        $width=$g.MeasureString($text,$font).Width
        if($align -eq 'center'){$x-=$width/2};if($align -eq 'right'){$x-=$width}
        $g.DrawString($text,$font,$brush,$x,$y)
    }finally{$font.Dispose();$brush.Dispose()}
}
function NewCanvas([int]$width,[int]$height){
    $bitmap=[Drawing.Bitmap]::new($width,$height);$bitmap.SetResolution(160,160)
    $graphics=[Drawing.Graphics]::FromImage($bitmap);$graphics.Clear([Drawing.Color]::White)
    $graphics.TextRenderingHint=[Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    return @{Bitmap=$bitmap;Graphics=$graphics}
}
function SaveCanvas($canvas,[string]$name){
    $path=Join-Path $outputPath $name;if(Test-Path -LiteralPath $path){throw "Refusing overwrite: $name"}
    try{$canvas.Bitmap.Save($path,[Drawing.Imaging.ImageFormat]::Png)}finally{$canvas.Graphics.Dispose();$canvas.Bitmap.Dispose()}
}
function Axes($g,[float]$x,[float]$y,[float]$size,[float]$scale,[bool]$heat){
    $gridColor=[Drawing.Color]::FromArgb(105,181,191,200);if($heat){$gridColor=[Drawing.Color]::FromArgb(65,255,255,255)}
    $grid=[Drawing.Pen]::new($gridColor,1)
    $border=[Drawing.Pen]::new([Drawing.Color]::FromArgb(85,98,112),1)
    $zeroColor=[Drawing.Color]::FromArgb(180,91,108,123);if($heat){$zeroColor=[Drawing.Color]::FromArgb(215,255,255,255)}
    $zero=[Drawing.Pen]::new($zeroColor,1);$zero.DashStyle=[Drawing.Drawing2D.DashStyle]::Dash
    try{
        foreach($tick in @(-1,-0.5,0,0.5,1)){
            $tx=$x+($tick+1)*$size/2;$ty=$y+(1-$tick)*$size/2
            if($tick -ne 0){$g.DrawLine($grid,[float]$tx,$y,[float]$tx,[float]($y+$size));$g.DrawLine($grid,$x,[float]$ty,[float]($x+$size),[float]$ty)}
            Label $g ([string]$tick) $tx ($y+$size+9*$scale) (20*$scale) 'center'
            Label $g ([string]$tick) ($x-12*$scale) ($ty-13*$scale) (20*$scale) 'right'
        }
        $g.DrawLine($zero,[float]($x+$size/2),$y,[float]($x+$size/2),[float]($y+$size))
        $g.DrawLine($zero,$x,[float]($y+$size/2),[float]($x+$size),[float]($y+$size/2))
        $originDiameter=$size*0.1
        $g.DrawEllipse($zero,[float]($x+$size/2-$originDiameter/2),[float]($y+$size/2-$originDiameter/2),[float]$originDiameter,[float]$originDiameter)
        $g.DrawRectangle($border,$x,$y,$size,$size)
        Label $g 'Valence' ($x+$size/2) ($y+$size+43*$scale) (22*$scale) 'center'
        $state=$g.Save();$g.TranslateTransform([float]($x-61*$scale),[float]($y+$size/2));$g.RotateTransform(-90)
        Label $g 'Arousal' 0 (-14*$scale) (22*$scale) 'center';$g.Restore($state)
    }finally{$grid.Dispose();$border.Dispose();$zero.Dispose()}
}
function Plot($g,[string]$key,[string]$kind,[float]$x,[float]$y,[int]$size,[float]$scale){
    $model=$data.models.$key;$state=$g.Save();$g.SetClip([Drawing.RectangleF]::new($x,$y,$size,$size))
    try{
        if($kind -eq 'scatter'){
            $g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $dot=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(28,20,106,155));$diameter=1.8*$scale
            try{
                $count=0
                foreach($point in $model.points){
                    $px=$x+([double]$point[0]+1)*$size/2;$py=$y+(1-[double]$point[1])*$size/2
                    $g.FillEllipse($dot,[float]($px-$diameter/2),[float]($py-$diameter/2),[float]$diameter,[float]$diameter);$count++
                }
                if($count -ne 27948){throw 'Scatter must contain every actual song'};$script:drawn[$key]+=$count
            }finally{$dot.Dispose()}
        }else{
            $g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::None
            $empty=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(243,245,247));$g.FillRectangle($empty,$x,$y,$size,$size);$empty.Dispose()
            $total=0
            for($iy=0;$iy -lt $data.bins;$iy++){
                for($ix=0;$ix -lt $data.bins;$ix++){
                    $n=[int]$model.heatmap[$iy][$ix];$total+=$n;if($n -eq 0){continue}
                    $color=[int][Math]::Round(255*[Math]::Log(1+$n)/[Math]::Log(1+$data.max_bin_count))
                    $left=[int][Math]::Round($x+$ix*$size/$data.bins);$right=[int][Math]::Round($x+($ix+1)*$size/$data.bins)
                    $top=[int][Math]::Round($y+$size-($iy+1)*$size/$data.bins);$bottom=[int][Math]::Round($y+$size-$iy*$size/$data.bins)
                    $g.FillRectangle($palette[$color],$left,$top,($right-$left),($bottom-$top))
                }
            }
            if($total -ne 27948){throw 'Histogram must conserve all 27,948 songs'}
        }
    }finally{$g.Restore($state)}
    $g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
    Axes $g $x $y $size $scale ($kind -eq 'density')
}
function Colorbar($g,[float]$x,[float]$y,[int]$width,[float]$scale){
    $low=[Math]::Log(2)/[Math]::Log(1+$data.max_bin_count)
    for($column=0;$column -lt $width;$column++){
        $fraction=$low+(1-$low)*$column/($width-1);$idx=[int][Math]::Round(255*$fraction)
        $g.FillRectangle($palette[$idx],[int]($x+$column),[int]$y,1,[int](19*$scale))
    }
    foreach($tick in @(1,2,5,10,20,50,100,200,[int]$data.max_bin_count)){
        if($tick -gt $data.max_bin_count){continue}
        $at=$x+$width*([Math]::Log(1+$tick)/[Math]::Log(1+$data.max_bin_count)-$low)/(1-$low)
        Label $g ([string]$tick) $at ($y+23*$scale) (18*$scale) 'center'
    }
    Label $g 'Shared scale: songs per 0.025 x 0.025 cell (log1p)' ($x+$width/2) ($y-32*$scale) (19*$scale) 'center'
    $empty=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(243,245,247))
    $g.FillRectangle($empty,[float]($x+$width-130*$scale),[float]($y-61*$scale),[float](20*$scale),[float](20*$scale));$empty.Dispose()
    Label $g '0 = empty' ($x+$width-104*$scale) ($y-62*$scale) (17*$scale)
}
if($LibraryOnly){return}
try{
    foreach($key in $models){
        $s=$data.models.$key.summary
        foreach($kind in @('scatter','density')){
            $canvas=NewCanvas 1000 1200;$g=$canvas.Graphics
            Label $g ("$key  |  "+$labels[$key]) 500 25 29 'center' $true
            Label $g '27,948 actual songs | fixed axes [-1,1] | no sampling or jitter' 500 73 18 'center'
            Plot $g $key $kind 150 145 700 1
            Label $g ('Mean (V,A): ({0:F4}, {1:F4})   |   Population SD: ({2:F4}, {3:F4})' -f $s.valence.mean,$s.arousal.mean,$s.valence.stddev,$s.arousal.stddev) 500 940 20 'center'
            Label $g ('Origin r <= 0.1: {0:N0} songs ({1:F2}%)   |   Circle marks r = 0.1' -f $s.near_origin.'.1'.count,$s.near_origin.'.1'.percent) 500 977 19 'center'
            if($kind -eq 'density'){Colorbar $g 150 1070 700 1}
            else{Label $g 'Small transparent points: alpha 0.110; all 27,948 observations retained.' 500 1050 18 'center'}
            Label $g 'Unverified local experiment | source coordinates and normalization unchanged' 500 1156 16 'center'
            SaveCanvas $canvas ($kind+'_'+$key+'.png')
        }
    }
    $canvas=NewCanvas 2700 1580;$g=$canvas.Graphics
    Label $g 'Five emotion coordinate models - identical 27,948-song population' 1350 16 32 'center' $true
    Label $g 'Valence (X), Arousal (Y) | every panel [-1,1] with equal aspect | no sampling, jitter or smoothing' 1350 65 20 'center'
    for($column=0;$column -lt 5;$column++){
        $key=$models[$column];$x=85+$column*530;$s=$data.models.$key.summary
        Label $g $key ($x+210) 104 27 'center' $true;Label $g $labels[$key] ($x+210) 141 17 'center'
        Plot $g $key 'scatter' $x 180 420 0.78
        Label $g ('Mean ({0:F3}, {1:F3})  SD ({2:F3}, {3:F3})' -f $s.valence.mean,$s.arousal.mean,$s.valence.stddev,$s.arousal.stddev) ($x+210) 676 16 'center'
        Label $g ('Origin r <= 0.1: {0:F2}%' -f $s.near_origin.'.1'.percent) ($x+210) 703 16 'center'
    }
    Label $g '2D density - common 80 x 80 bins and one shared count scale' 1350 749 25 'center' $true
    for($column=0;$column -lt 5;$column++){
        $key=$models[$column];$x=85+$column*530;$s=$data.models.$key.summary
        Label $g $key ($x+210) 787 26 'center' $true;Label $g $labels[$key] ($x+210) 821 17 'center'
        Plot $g $key 'density' $x 860 420 0.78
        Label $g ('Peak cell: {0} songs | Empty cells: {1:F1}%' -f $s.histogram.max_bin_count,$s.histogram.empty_bin_percent) ($x+210) 1357 16 'center'
    }
    Colorbar $g 450 1450 1800 1.05
    Label $g 'Actual common-song data only | circles: origin radius 0.1 | density is descriptive, not emotion accuracy' 1350 1537 18 'center'
    SaveCanvas $canvas 'comparison_all.png'
    foreach($key in $models){if($script:drawn[$key] -ne 55896){throw 'Both scatter panels must include the entire population'}}
    $proof=@{result='PASS';renderer='Windows System.Drawing';points_per_scatter_panel=27948;scatter_draw_calls_per_model=$script:drawn;individual_pixels=@(1000,1200);combined_pixels=@(2700,1580);plot_limits=@(-1,1);individual_plot_pixels=700;combined_plot_pixels=420;equal_aspect=$true;shared_histogram_max=[int]$data.max_bin_count;shared_histogram_bins=[int]$data.bins;png_count=11}
    $proof | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outputPath 'render-verification.json') -Encoding UTF8
    'PASS: 10 individual PNGs and 1 combined PNG; every scatter panel draws 27,948 points.'
}finally{foreach($brush in $palette){$brush.Dispose()}}
