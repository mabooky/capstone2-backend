param([Parameter(Mandatory=$true)][string]$OutputDir)
$ErrorActionPreference='Stop'
# Reuse the existing native renderer; no new graphics dependencies.
. (Join-Path $PSScriptRoot 'render_coordinate_plots.ps1') -OutputDir $OutputDir -LibraryOnly
$counts=@{}
function SelectionPlot($g,$key,$kind,[float]$x,[float]$y,[int]$size,$range){
    $model=$data.models.$key;$state=$g.Save();$g.SetClip([Drawing.RectangleF]::new($x,$y,$size,$size))
    try{
        if($kind -eq 'scatter'){
            $g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias;$brushes=@{};$n=0
            try{
                foreach($point in $model.points){
                    $alpha=[int][Math]::Max(1,[Math]::Min(255,[Math]::Round(28*27948/$model.summary.mass*[double]$point[2])))
                    if(-not $brushes.ContainsKey($alpha)){$brushes[$alpha]=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb($alpha,20,106,155))}
                    $px=$x+([double]$point[0]+1)*$size/2;$py=$y+(1-[double]$point[1])*$size/2
                    $g.FillEllipse($brushes[$alpha],[float]($px-0.8),[float]($py-0.8),[float]1.6,[float]1.6);$n++
                }
                if($n -ne $model.summary.n){throw "Point conservation failed: $key"}
                $counts[$key]=$n
            }finally{foreach($brush in $brushes.Values){$brush.Dispose()}}
        }else{
            $g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::None
            $empty=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(243,245,247));$g.FillRectangle($empty,$x,$y,$size,$size);$empty.Dispose()
            $total=0.0;$low=[Math]::Log($range.min_positive);$span=[Math]::Log($range.max_probability_percent)-$low
            for($iy=0;$iy -lt $data.bins;$iy++){
                for($ix=0;$ix -lt $data.bins;$ix++){
                    $p=[double]$model.heatmap[$iy][$ix];$total+=$p;if($p -eq 0){continue}
                    $ci=[int][Math]::Max(0,[Math]::Min(255,[Math]::Round(255*([Math]::Log($p)-$low)/$span)))
                    $left=[int][Math]::Round($x+$ix*$size/$data.bins);$right=[int][Math]::Round($x+($ix+1)*$size/$data.bins)
                    $top=[int][Math]::Round($y+$size-($iy+1)*$size/$data.bins);$bottom=[int][Math]::Round($y+$size-$iy*$size/$data.bins)
                    $g.FillRectangle($palette[$ci],$left,$top,($right-$left),($bottom-$top))
                }
            }
            if([Math]::Abs($total-100) -gt 0.000001){throw "Probability mass failed: $key"}
        }
    }finally{$g.Restore($state)}
    $g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
    Axes $g $x $y $size 0.85 ($kind -eq 'density')
}
function ProbabilityLegend($g,[float]$x,[float]$y,[int]$width,$range){
    for($i=0;$i -lt 256;$i++){$g.FillRectangle($palette[$i],[float]($x+$i*$width/256),$y,[float]($width/256+1),[float]18)}
    $lo=[Math]::Log($range.min_positive);$span=[Math]::Log($range.max_probability_percent)-$lo
    foreach($tick in @(0.001,0.003,0.01,0.03,0.1,0.3,1,3)){
        if($tick -ge $range.min_positive -and $tick -le $range.max_probability_percent){
            $pos=$x+([Math]::Log($tick)-$lo)/$span*$width
            Label $g "$tick%" $pos ($y+23) 18 'center'
        }
    }
    Label $g 'Probability per 80 x 80 bin; shared log color scale; gray = zero' ($x+$width/2) ($y+54) 21 'center'
}
function MainPage($g,$version){
    $title=if($version -eq 'theoretical'){'Theoretical normalization (B1)'}else{'Fixed full-MuSe observed normalization (B2)'}
    Label $g "MuSe selection and matching | $title" 50 23 31 'left' $true
    Label $g 'Same source coordinates, fixed [-1, 1] axes, no sampling / jitter / merged duplicate coordinates' 50 69 21
    for($col=0;$col -lt 4;$col++){
        $frame=$data.main_order[$col];$key=$frame+'_'+$version;$m=$data.models.$key;$x=80+$col*570
        Label $g $data.labels.$frame ($x+210) 113 26 'center' $true
        $caption=if($frame -eq 'id_balanced'){'60,741 ID weights / 61,902 source rows'}else{('{0:N0} source observations' -f $m.summary.n)}
        Label $g $caption ($x+210) 150 19 'center'
        SelectionPlot $g $key 'scatter' $x 190 420 $data.main_color
        Label $g ('Mean V/A {0:F4}, {1:F4}' -f $m.summary.valence.mean,$m.summary.arousal.mean) ($x+210) 697 21 'center'
        Label $g ('SD V/A {0:F4}, {1:F4}' -f $m.summary.valence.stddev,$m.summary.arousal.stddev) ($x+210) 728 20 'center'
        SelectionPlot $g $key 'density' $x 840 420 $data.main_color
    }
    Label $g 'Scatter opacity accounts for group mass and ID weights; all real observations retained.' 50 1370 21
    ProbabilityLegend $g 650 1420 1000 $data.main_color
    Label $g 'ID-balanced panel is a sensitivity distribution, not one resolved coordinate per ID.' 50 1540 21
}
try{
    foreach($version in @('theoretical','observed')){
        $canvas=NewCanvas 2320 1590;MainPage $canvas.Graphics $version
        SaveCanvas $canvas ('comparison_'+$version+'.png')
    }
    $canvas=NewCanvas 2320 3180
    MainPage $canvas.Graphics 'theoretical';$canvas.Graphics.TranslateTransform([float]0,[float]1590)
    MainPage $canvas.Graphics 'observed';SaveCanvas $canvas 'selection_bias_all.png'
    $canvas=NewCanvas 3280 1630;$g=$canvas.Graphics
    Label $g 'MuSe selection stages and duplicate source rows' 40 20 32 'left' $true
    Label $g 'Row populations and singleton-ID populations are labeled separately; fixed normalization and probability bins.' 40 65 21
    for($row=0;$row -lt 2;$row++){
        $version=@('theoretical','observed')[$row];$top=190+$row*700
        Label $g ($version+' normalization') 40 ($top-92) 24 'left' $true
        for($col=0;$col -lt 6;$col++){
            $frame=$data.stage_order[$col];$key=$frame+'_'+$version;$m=$data.models.$key;$x=75+$col*535
            Label $g $data.labels.$frame ($x+200) ($top-55) 22 'center' $true
            Label $g ('{0:N0} observations' -f $m.summary.n) ($x+200) ($top-25) 19 'center'
            SelectionPlot $g $key 'density' $x $top 400 $data.stage_color
            Label $g ('Mean {0:F3}, {1:F3}' -f $m.summary.valence.mean,$m.summary.arousal.mean) ($x+200) ($top+485) 20 'center'
        }
    }
    ProbabilityLegend $g 1100 1480 1000 $data.stage_color
    SaveCanvas $canvas 'matching_and_duplicates.png'
    @{result='PASS';scatter_observations=$counts;plot_limits=@(-1,1);equal_aspect=$true;bins=80;probability_mass_percent=100;shared_main_color=$data.main_color;shared_stage_color=$data.stage_color;all_source_points=$true;no_jitter=$true} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputPath 'render-verification.json') -Encoding UTF8
}finally{foreach($brush in $palette){$brush.Dispose()}}
